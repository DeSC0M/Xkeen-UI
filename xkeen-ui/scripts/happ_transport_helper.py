from __future__ import annotations

import base64
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from services.mihomo_hwid_sub import get_device_info


DEFAULT_HAPP_UA = "Happ/3.18.3/Android/17771400994551771562"
DEFAULT_TIMEOUT = 20.0
# Set by the panel for a subscription with its own HWID and User-Agent.
REQUEST_HEADERS_ENV = "XKEEN_HAPP_HELPER_REQUEST_HEADERS"


def _normalize_input(value: str) -> str:
    text = str(value or "").strip()
    if text.lower().startswith("incy://import/"):
        return text[len("incy://import/") :].strip()
    return text


def _is_http_url(value: str) -> bool:
    return urllib.parse.urlsplit(str(value or "").strip()).scheme.lower() in {"http", "https"}


def _decode_base64(text: str) -> str:
    raw = "".join(str(text or "").split())
    if len(raw) < 16:
        return ""
    try:
        raw = raw.replace("-", "+").replace("_", "/")
        raw += "=" * ((4 - len(raw) % 4) % 4)
        return base64.b64decode(raw, validate=False).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _subscription_headers() -> dict[str, str]:
    try:
        data = json.loads(os.environ.get(REQUEST_HEADERS_ENV) or "{}")
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k).strip(): str(v).strip() for k, v in data.items() if str(k).strip() and str(v).strip()}


def _build_happ_headers() -> tuple[dict[str, str], str]:
    own = _subscription_headers()
    lowered = {key.lower(): value for key, value in own.items()}
    info = get_device_info()
    # XKEEN_HAPP_HELPER_HWID is no longer offered in the panel; an env file
    # that still sets it keeps working.
    hwid = str(lowered.get("x-hwid") or os.environ.get("XKEEN_HAPP_HELPER_HWID") or info.get("hwid") or "").strip()
    if not hwid:
        raise RuntimeError("missing_hwid")
    ua = str(lowered.get("user-agent") or os.environ.get("XKEEN_SUBSCRIPTION_HAPP_USER_AGENT") or DEFAULT_HAPP_UA).strip()
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    headers.update({key: value for key, value in own.items() if key.lower() not in {"user-agent", "x-hwid"}})
    headers["User-Agent"] = ua
    headers["X-HWID"] = hwid
    return headers, hwid


def _append_hwid_query(url: str, hwid: str) -> str:
    parts = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    if not any(str(key).lower() == "hwid" for key, _value in query):
        query.append(("hwid", hwid))
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), parts.fragment)
    )


def _fetch_text(url: str, headers: dict[str, str], timeout: float) -> str:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def _normalize_payload(text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return ""
    decoded = _decode_base64(raw)
    if decoded:
        return urllib.parse.unquote(decoded).strip()
    return urllib.parse.unquote(raw).strip()


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    if len(argv) < 2:
        print("usage: happ_transport_helper.py <http(s)-url-or-incy-import>", file=sys.stderr)
        return 2

    source = _normalize_input(argv[1])
    if not _is_http_url(source):
        print("helper expects HTTP(S) landing URL or incy://import/ URL", file=sys.stderr)
        return 2

    headers, hwid = _build_happ_headers()
    timeout_raw = str(os.environ.get("XKEEN_HAPP_HELPER_TIMEOUT") or "").strip()
    try:
        timeout = max(1.0, min(120.0, float(timeout_raw))) if timeout_raw else DEFAULT_TIMEOUT
    except Exception:
        timeout = DEFAULT_TIMEOUT

    errors: list[str] = []
    for candidate in (_append_hwid_query(source, hwid), source):
        try:
            payload = _normalize_payload(_fetch_text(candidate, headers, timeout))
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
            continue
        if not payload:
            errors.append(f"{candidate}: empty payload")
            continue
        if payload.lstrip().lower().startswith(("<!doctype html", "<html")):
            errors.append(f"{candidate}: still returned html landing page")
            continue
        print(
            json.dumps(
                {
                    "text": payload,
                    "source_url": candidate,
                    "used_hwid": hwid,
                    "headers": {},
                },
                ensure_ascii=False,
            )
        )
        return 0

    for line in errors:
        print(line, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
