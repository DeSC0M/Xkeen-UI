#!/usr/bin/env python3
"""Collect a read-only Stage 8.8 router acceptance snapshot.

This tool is deliberately unable to run lifecycle plans, profile transitions,
restarts, or fault injection.  It captures the evidence needed to decide
whether a router is a *separate safe stand* before someone runs the destructive
part of the Stage 8.8 matrix by hand.

After the login form it sends GET requests only.  Two of them may still touch
the router's files: ``/api/modules/available`` may fetch and cache the signed
catalog, and ``/api/notifications`` may rewrite its state file when it
normalizes it.  The report lists both under ``panel_side_effects``.

Passwords are read from environment variables or asked for at the terminal,
never taken from the command line (where the process list would show them),
and are never written to the JSON report.
"""

from __future__ import annotations

import argparse
import getpass
import http.cookiejar
import json
import os
import platform
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit


REPORT_SCHEMA_VERSION = 1
HTTP_ENDPOINTS = (
    "/api/modules/installed",
    "/api/modules/operations/status",
    "/api/modules/update-channel",
    "/api/modules/available",
    "/api/notifications",
)
PANEL_SIDE_EFFECTS = (
    "GET /api/modules/available может скачать и сохранить подписанный каталог",
    "GET /api/notifications может переписать файл уведомлений при нормализации",
)
SSH_READ_ONLY_COMMAND = r"""
printf '%s\n' '--- uname ---'
uname -a
printf '%s\n' '--- disk ---'
df -k /opt 2>/dev/null || true
printf '%s\n' '--- profile ---'
cat /opt/etc/xkeen-ui/install-profile.json 2>/dev/null || true
printf '%s\n' '--- modules ---'
cat /opt/etc/xkeen-ui/modules.json 2>/dev/null || true
printf '%s\n' '--- build ---'
cat /opt/etc/xkeen-ui/BUILD.json 2>/dev/null || true
printf '%s\n' '--- lifecycle ---'
cat /opt/etc/xkeen-ui/module-operations/status.json 2>/dev/null || true
printf '%s\n' '--- process ---'
ps w | grep -E 'run_server.py|xkeen-ui|mihomo|xray' | grep -v grep || true
""".strip()


def _option(value: str | None, environment: str) -> str:
    return str(value or os.environ.get(environment) or "").strip()


def _redacted_url(raw: str) -> str:
    parsed = urlsplit(raw)
    return urlunsplit((parsed.scheme, "<router>" if parsed.netloc else "", parsed.path, "", ""))


def _safe_error(error: BaseException) -> str:
    return f"{type(error).__name__}: {str(error)[:180]}"


def _bounded_text(value: bytes | str, limit: int = 16 * 1024) -> str:
    raw = value if isinstance(value, bytes) else str(value).encode("utf-8", "replace")
    return raw[:limit].decode("utf-8", "replace")


def _json_response(response: Any) -> Any:
    raw = response.read()
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {"raw": _bounded_text(raw)}


def _csrf_token(html: str) -> str:
    match = re.search(r'name=["\']csrf_token["\']\s+value=["\']([^"\']+)', html)
    if not match:
        raise ValueError("login form does not contain a CSRF token")
    return match.group(1)


def _fetch(opener: Any, base_url: str, path: str, *, timeout_s: float) -> dict[str, Any]:
    try:
        with opener.open(base_url.rstrip("/") + path, timeout=timeout_s) as response:
            return {"status": int(response.status), "body": _json_response(response)}
    except urllib.error.HTTPError as error:
        return {"status": int(error.code), "body": _json_response(error)}
    except Exception as error:  # noqa: BLE001 - a smoke report records partial reachability
        return {"status": None, "error": _safe_error(error)}


def _session_accepted(landed_path: str, first: Mapping[str, Any]) -> bool:
    # A refused login answers 200 with the login page again (or the lockout
    # page): only a session that reads the API as JSON is a login.
    body = first.get("body")
    return (
        not landed_path.rstrip("/").endswith("/login")
        and first.get("status") == 200
        and isinstance(body, Mapping)
        and "raw" not in body
    )


def collect_http(
    base_url: str,
    username: str,
    password: str,
    *,
    timeout_s: float,
    opener: Any = None,
) -> dict[str, Any]:
    """Authenticate to the panel and issue only GET requests after login."""

    if opener is None:
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
    login_url = base_url.rstrip("/") + "/login"
    report: dict[str, Any] = {"base_url": _redacted_url(base_url), "endpoints": {}}
    try:
        with opener.open(login_url, timeout=timeout_s) as response:
            login_page = _bounded_text(response.read())
        csrf = _csrf_token(login_page)
        form = urllib.parse.urlencode(
            {"username": username, "password": password, "csrf_token": csrf}
        ).encode("utf-8")
        request = urllib.request.Request(
            login_url,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with opener.open(request, timeout=timeout_s) as response:
            report["login_status"] = int(response.status)
            landed_path = urlsplit(response.geturl()).path
        first, *rest = HTTP_ENDPOINTS
        report["endpoints"][first] = _fetch(opener, base_url, first, timeout_s=timeout_s)
        if not _session_accepted(landed_path, report["endpoints"][first]):
            # One refused attempt per run: asking again would only bring the
            # login lockout closer.
            report["login_error"] = "login_failed: the panel did not accept the credentials"
            return report
        for path in rest:
            report["endpoints"][path] = _fetch(opener, base_url, path, timeout_s=timeout_s)
    except Exception as error:  # noqa: BLE001 - a smoke report must remain writable offline
        report["login_error"] = _safe_error(error)
    return report


def collect_ssh(host: str, port: int, password: str, *, timeout_s: float) -> dict[str, Any]:
    """Run the fixed read-only router command through optional Paramiko."""

    report: dict[str, Any] = {"host": "<router>", "port": int(port), "command": "fixed-read-only"}
    try:
        import paramiko
    except ImportError:
        report["error"] = "paramiko is not installed; SSH evidence was skipped"
        return report
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=int(port),
            username="root",
            password=password,
            timeout=timeout_s,
            banner_timeout=timeout_s,
            auth_timeout=timeout_s,
            look_for_keys=False,
            allow_agent=False,
        )
        _stdin, stdout, stderr = client.exec_command(SSH_READ_ONLY_COMMAND, timeout=timeout_s)
        report["stdout"] = _bounded_text(stdout.read())
        report["stderr"] = _bounded_text(stderr.read())
        report["exit_status"] = int(stdout.channel.recv_exit_status())
    except Exception as error:  # noqa: BLE001 - SSH must not hide HTTP evidence
        report["error"] = _safe_error(error)
    finally:
        client.close()
    return report


def _endpoint_body(http: Mapping[str, Any], path: str) -> Mapping[str, Any]:
    endpoint = http.get("endpoints", {}).get(path, {})
    body = endpoint.get("body") if isinstance(endpoint, Mapping) else None
    return body if isinstance(body, Mapping) else {}


def evaluate_safety(http: Mapping[str, Any], ssh: Mapping[str, Any] | None) -> dict[str, Any]:
    """State why this device may or may not receive destructive Stage 8.8 work."""

    installed = _endpoint_body(http, "/api/modules/installed")
    available = _endpoint_body(http, "/api/modules/available")
    lifecycle = installed.get("lifecycle") if isinstance(installed.get("lifecycle"), Mapping) else {}
    profile = str(installed.get("profile") or "")
    active_modules = set(installed.get("installed_module_ids") or ())
    reasons: list[str] = []
    if http.get("login_error"):
        reasons.append("вход в панель не удался: данных панели в отчёте нет, проверьте логин и пароль")
    if lifecycle.get("local") is True:
        reasons.append("локальная сборка: signed lifecycle операции намеренно read-only")
    if profile == "mihomo-minimal":
        reasons.append("mihomo-minimal запрещён для destructive smoke: на нём работает интернет")
    if "engine.mihomo" in active_modules:
        reasons.append("Mihomo установлен: не менять профиль или engine без отдельного безопасного стенда")
    if available.get("read_only") is True:
        reasons.append("available catalog read-only: module install/repair/remove недоступны")
    if not ssh or ssh.get("exit_status") != 0:
        reasons.append("SSH evidence неполное; power-loss/disk-full drill не разрешён")
    return {
        "writes_performed": False,
        "profile_transition_performed": False,
        "engine_toggle_performed": False,
        "restart_performed": False,
        "fault_injection_performed": False,
        "destructive_smoke_allowed": False,
        "panel_side_effects": list(PANEL_SIDE_EFFECTS),
        "blockers": reasons,
    }


def build_report(http: Mapping[str, Any], ssh: Mapping[str, Any] | None) -> dict[str, Any]:
    installed = _endpoint_body(http, "/api/modules/installed")
    status = _endpoint_body(http, "/api/modules/operations/status")
    available = _endpoint_body(http, "/api/modules/available")
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scope": "read-only preflight",
        "collector": {"python": sys.version.split()[0], "platform": platform.platform()},
        "panel": {
            "version": installed.get("panel_version"),
            "profile": installed.get("profile"),
            "editor": installed.get("editor"),
            "installed_module_ids": installed.get("installed_module_ids"),
            "update_channel": installed.get("update_channel"),
            "lifecycle": installed.get("lifecycle"),
            "available": {
                key: available.get(key)
                for key in ("release_version", "read_only", "freshness", "stale_reason")
            },
            "last_operation": {
                key: status.get(key)
                for key in ("operation_id", "scope", "operation", "module_id", "result", "error_code", "version")
            },
        },
        "http": dict(http),
        "ssh": dict(ssh) if ssh is not None else None,
        "safety": evaluate_safety(http, ssh),
    }


def build_parser() -> argparse.ArgumentParser:
    # No password options: a command line is visible in the process list.
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--http-url", required=True, help="Panel base URL, e.g. http://router:8088")
    parser.add_argument("--panel-user", default="", help="or XKEEN_STAGE88_PANEL_USER")
    parser.add_argument("--ssh-host", default="", help="optional router SSH host, or XKEEN_STAGE88_SSH_HOST")
    parser.add_argument("--ssh-port", type=int, default=222)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--output", type=Path, required=True)
    parser.epilog = (
        "Passwords: XKEEN_STAGE88_PANEL_PASSWORD and XKEEN_STAGE88_SSH_PASSWORD, "
        "or typed at the prompt when the variable is empty."
    )
    return parser


def parse_args() -> argparse.Namespace:
    return build_parser().parse_args()


def _secret(environment: str, prompt: str) -> str:
    value = os.environ.get(environment) or ""
    # On Windows NUL passes for a terminal: the prompt is shown on stderr,
    # so only a person at a terminal on both ends is asked.
    if not value and sys.stdin.isatty() and sys.stderr.isatty():
        value = getpass.getpass(prompt)
    return value


def main() -> int:
    args = parse_args()
    panel_user = _option(args.panel_user, "XKEEN_STAGE88_PANEL_USER")
    panel_password = _secret("XKEEN_STAGE88_PANEL_PASSWORD", "Пароль панели: ") if panel_user else ""
    if not panel_user or not panel_password:
        raise SystemExit("panel credentials are required: --panel-user and XKEEN_STAGE88_PANEL_PASSWORD (or the prompt)")
    http = collect_http(args.http_url, panel_user, panel_password, timeout_s=max(1.0, args.timeout))
    ssh_host = _option(args.ssh_host, "XKEEN_STAGE88_SSH_HOST")
    ssh_password = _secret("XKEEN_STAGE88_SSH_PASSWORD", "Пароль SSH root: ") if ssh_host else ""
    ssh = collect_ssh(ssh_host, args.ssh_port, ssh_password, timeout_s=max(1.0, args.timeout)) if ssh_host and ssh_password else None
    report = build_report(http, ssh)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"output": str(args.output), "safety": report["safety"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
