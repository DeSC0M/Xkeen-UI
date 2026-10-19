from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "stage8_8_router_smoke.py"


def _load():
    spec = importlib.util.spec_from_file_location("stage8_8_router_smoke", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _http(*, local: bool = False, profile: str = "custom", read_only: bool = False):
    return {
        "endpoints": {
            "/api/modules/installed": {
                "status": 200,
                "body": {
                    "panel_version": "2.10.0-beta.2+local.abc" if local else "2.10.0-beta.2",
                    "profile": profile,
                    "installed_module_ids": ["core", "engine.mihomo"],
                    "lifecycle": {"available": True, **({"local": True} if local else {})},
                },
            },
            "/api/modules/available": {"status": 200, "body": {"read_only": read_only}},
            "/api/modules/operations/status": {"status": 200, "body": {"result": "committed"}},
        }
    }


def test_router_smoke_never_names_mutating_lifecycle_routes():
    source = SCRIPT.read_text(encoding="utf-8")
    assert '"/api/modules/operations/apply"' not in source
    assert '"/api/modules/profile"' not in source
    assert '"/api/modules/restart"' not in source
    assert '"/api/modules/<module_id>"' not in source


def test_router_smoke_blocks_a_local_panel_with_mihomo_before_destructive_checks():
    smoke = _load()
    safety = smoke.evaluate_safety(_http(local=True, read_only=True), {"exit_status": 0})

    assert safety["writes_performed"] is False
    assert safety["destructive_smoke_allowed"] is False
    assert any("локальная сборка" in item for item in safety["blockers"])
    assert any("Mihomo" in item for item in safety["blockers"])


def test_router_smoke_marks_mihomo_minimal_as_protected():
    smoke = _load()
    safety = smoke.evaluate_safety(_http(profile="mihomo-minimal"), {"exit_status": 0})

    assert safety["destructive_smoke_allowed"] is False
    assert any("mihomo-minimal" in item for item in safety["blockers"])


ROUTES = ROOT / "xkeen-ui" / "routes"
ROUTE_DECORATOR = re.compile(r'@\w+\.(get|post|put|patch|delete|route)\(\s*"([^"]+)"')


def test_router_smoke_reads_only_routes_the_panel_declares_as_get():
    smoke = _load()
    methods: dict[str, set[str]] = {}
    for source in ROUTES.glob("*.py"):
        for method, path in ROUTE_DECORATOR.findall(source.read_text(encoding="utf-8")):
            methods.setdefault(path, set()).add(method)

    for path in smoke.HTTP_ENDPOINTS:
        # Every address has its own GET handler; `route` could carry any
        # method. A POST next to it (update-channel) is a separate handler
        # the collector never calls: the opener test below proves the method.
        assert "get" in methods.get(path, set()), path
        assert "route" not in methods[path], path


class _Response:
    def __init__(self, url: str, body: bytes, status: int = 200):
        self._url = url
        self._body = body
        self.status = status

    def read(self):
        return self._body

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class _Opener:
    LOGIN_PAGE = b'<form><input type="hidden" name="csrf_token" value="t0k3n"></form>'

    def __init__(self, *, accept: bool):
        self.accept = accept
        self.calls: list[tuple[str, str]] = []

    def open(self, target, timeout=None):
        if isinstance(target, str):
            method, url = "GET", target
        else:
            method, url = target.get_method(), target.full_url
        path = urlsplit(url).path
        self.calls.append((method, path))
        if path == "/login":
            if method == "GET":
                return _Response(url, self.LOGIN_PAGE)
            # A refused login draws the form again with 200.
            landed = "http://router:8088/" if self.accept else url
            return _Response(landed, b"<html>welcome</html>" if self.accept else self.LOGIN_PAGE)
        if not self.accept:
            return _Response("http://router:8088/login", self.LOGIN_PAGE)
        return _Response(url, json.dumps({"ok": True, "path": path}).encode("utf-8"))


def test_router_smoke_sends_get_only_after_the_login_form():
    smoke = _load()
    opener = _Opener(accept=True)

    report = smoke.collect_http("http://router:8088", "admin", "secret", timeout_s=1, opener=opener)

    assert "login_error" not in report
    assert opener.calls[:2] == [("GET", "/login"), ("POST", "/login")]
    assert opener.calls[2:] == [("GET", path) for path in smoke.HTTP_ENDPOINTS]
    assert "secret" not in json.dumps(report)


def test_router_smoke_stops_after_one_refused_login_and_says_so():
    smoke = _load()
    opener = _Opener(accept=False)

    report = smoke.collect_http("http://router:8088", "admin", "wrong", timeout_s=1, opener=opener)
    safety = smoke.evaluate_safety(report, {"exit_status": 0})

    assert report["login_error"].startswith("login_failed")
    # One login attempt and one probe of the API; nothing more is asked.
    assert [call for call in opener.calls if call[1] == "/login"] == [("GET", "/login"), ("POST", "/login")]
    assert opener.calls[2:] == [("GET", smoke.HTTP_ENDPOINTS[0])]
    assert any("вход в панель не удался" in item for item in safety["blockers"])


def test_router_smoke_names_its_side_effects_on_the_panel():
    smoke = _load()
    safety = smoke.evaluate_safety(_http(), {"exit_status": 0})

    effects = " ".join(safety["panel_side_effects"])
    assert "/api/modules/available" in effects
    assert "/api/notifications" in effects


def test_router_smoke_takes_no_password_from_the_command_line():
    smoke = _load()
    options = {option for action in smoke.build_parser()._actions for option in action.option_strings}

    assert not any("password" in option for option in options)
    assert "XKEEN_STAGE88_PANEL_PASSWORD" in smoke.build_parser().epilog


def test_router_smoke_asks_for_a_password_only_at_a_terminal(monkeypatch):
    smoke = _load()
    asked: list[str] = []
    monkeypatch.setattr(smoke.getpass, "getpass", lambda prompt: asked.append(prompt) or "typed")
    monkeypatch.delenv("XKEEN_STAGE88_PANEL_PASSWORD", raising=False)

    # On Windows NUL passes for a terminal: without one for the prompt nobody is asked.
    monkeypatch.setattr(smoke.sys.stdin, "isatty", lambda: True, raising=False)
    monkeypatch.setattr(smoke.sys.stderr, "isatty", lambda: False, raising=False)
    assert smoke._secret("XKEEN_STAGE88_PANEL_PASSWORD", "Пароль панели: ") == ""
    assert asked == []

    monkeypatch.setattr(smoke.sys.stderr, "isatty", lambda: True, raising=False)
    assert smoke._secret("XKEEN_STAGE88_PANEL_PASSWORD", "Пароль панели: ") == "typed"

    monkeypatch.setenv("XKEEN_STAGE88_PANEL_PASSWORD", "from-env")
    assert smoke._secret("XKEEN_STAGE88_PANEL_PASSWORD", "Пароль панели: ") == "from-env"
    assert len(asked) == 1


def test_router_smoke_redacts_router_address_and_uses_only_fixed_ssh_command():
    smoke = _load()
    assert smoke._redacted_url("http://192.168.1.1:8088/") == "http://<router>/"
    assert "cat /opt/etc/xkeen-ui/BUILD.json" in smoke.SSH_READ_ONLY_COMMAND
    assert "rm " not in smoke.SSH_READ_ONLY_COMMAND
    assert "restart" not in smoke.SSH_READ_ONLY_COMMAND
