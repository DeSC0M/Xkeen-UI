"""HWID и User-Agent из профиля подписки доходят до помощника Happ.

Страницу-обёртку Happ помощник скачивает сам. Раньше он брал HWID и UA только
из окружения и устройства, и заданные в подписке («свой» профиль) значения на
таких ссылках молча терялись. В режиме «авто» помощник по-прежнему решает сам.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "xkeen-ui"
sys.path.insert(0, str(APP))

from services import happ_links  # noqa: E402
from services import xray_subscriptions as subs  # noqa: E402

LANDING = (
    '<html><body><a href="happ://crypt5/demo-token">Happ</a>'
    '<a href="incy://import/https://example.com/sub">Incy</a></body></html>'
)
PROFILE = {
    "mode": "custom",
    "user_agent": "MyClient/1.0",
    "hwid": "SUB-HWID-1",
    "device_os": "",
    "os_version": "",
    "device_model": "",
}


def _helper_module(monkeypatch):
    spec = importlib.util.spec_from_file_location("happ_transport_helper", APP / "scripts" / "happ_transport_helper.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "get_device_info", lambda: {"hwid": "DEVICE-HWID"})
    return module


def test_helper_takes_hwid_and_user_agent_from_the_subscription_profile(monkeypatch):
    helper = _helper_module(monkeypatch)
    monkeypatch.setenv(
        happ_links.HAPP_HELPER_REQUEST_HEADERS_ENV,
        json.dumps({"User-Agent": "MyClient/1.0", "X-HWID": "SUB-HWID-1", "X-Device-OS": "Android"}),
    )

    headers, hwid = helper._build_happ_headers()

    assert hwid == "SUB-HWID-1"
    assert headers["User-Agent"] == "MyClient/1.0"
    assert headers["X-HWID"] == "SUB-HWID-1"
    assert headers["X-Device-OS"] == "Android"


def test_helper_without_a_profile_keeps_the_device_hwid_and_happ_user_agent(monkeypatch):
    helper = _helper_module(monkeypatch)
    monkeypatch.delenv(happ_links.HAPP_HELPER_REQUEST_HEADERS_ENV, raising=False)
    monkeypatch.delenv("XKEEN_HAPP_HELPER_HWID", raising=False)
    monkeypatch.delenv("XKEEN_SUBSCRIPTION_HAPP_USER_AGENT", raising=False)

    headers, hwid = helper._build_happ_headers()

    assert hwid == "DEVICE-HWID"
    assert headers["User-Agent"] == helper.DEFAULT_HAPP_UA


def test_run_helper_hands_the_headers_to_the_helper_process(monkeypatch):
    seen = {}

    def fake_run(command, **kwargs):
        seen["env"] = kwargs.get("env")
        return subprocess.CompletedProcess(command, 0, stdout='{"text": "vless://demo"}', stderr="")

    monkeypatch.setattr(happ_links, "helper_command_parts", lambda: [sys.executable, "helper.py"])
    monkeypatch.setattr(happ_links.subprocess, "run", fake_run)

    happ_links.run_helper("https://example.com/sub", request_headers={"X-HWID": "SUB-HWID-1"})

    assert json.loads(seen["env"][happ_links.HAPP_HELPER_REQUEST_HEADERS_ENV]) == {"X-HWID": "SUB-HWID-1"}


def _fetch_landing(monkeypatch, profile):
    calls = []

    def fake_once(url, request_headers=None):
        return LANDING, {"content-type": "text/html; charset=utf-8"}

    def fake_resolve(url, *, body=None, content_type=None, helper_headers=None):
        calls.append(helper_headers)
        return {"kind": "text", "value": "vless://demo", "headers": {}, "via": "helper"}

    monkeypatch.setattr(subs, "_fetch_subscription_body_once", fake_once)
    monkeypatch.setattr(subs.happ_links, "resolve_source", fake_resolve)
    subs.fetch_subscription_body_for_xray("https://example.com/sub", request_profile=profile)
    return calls


def test_a_custom_profile_reaches_the_helper(monkeypatch):
    calls = _fetch_landing(monkeypatch, PROFILE)

    assert calls and calls[0]["User-Agent"] == "MyClient/1.0"
    assert calls[0]["x-hwid"] == "SUB-HWID-1"


def test_the_automatic_profile_leaves_the_helper_to_its_own_defaults(monkeypatch):
    calls = _fetch_landing(monkeypatch, {"mode": "auto"})

    assert calls == [None]
