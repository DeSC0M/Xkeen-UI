from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

from flask import Flask
from werkzeug.security import generate_password_hash


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "xkeen-ui"

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))


def _reload(name: str):
    module = sys.modules.get(name)
    if module is not None:
        return importlib.reload(module)
    return importlib.import_module(name)


def _build_client(tmp_path: Path, monkeypatch, *, configured: bool = True):
    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("XKEEN_UI_STATE_DIR", str(state_dir))
    monkeypatch.setenv("XKEEN_UI_SECRET_KEY", "test-secret-key")

    _reload("core.paths")
    auth_setup = _reload("services.auth_setup")
    _reload("services.auth_rate_limit")
    mobile_routes = _reload("routes.mobile")

    if configured:
        auth_setup._atomic_write(
            auth_setup.AUTH_FILE,
            json.dumps(
                {
                    "version": 1,
                    "created_at": 0,
                    "username": "admin",
                    "password_hash": generate_password_hash("secret123"),
                }
            ),
            mode=0o600,
        )

    app = Flask("mobile-session-test")
    app.config["TESTING"] = True

    auth_setup.init_auth(app)
    mobile_routes.register_mobile_routes(app)
    client = app.test_client()
    client.environ_base["REMOTE_ADDR"] = "198.51.100.20"
    return client


def test_bootstrap_exposes_only_configuration_and_current_session_state(tmp_path: Path, monkeypatch):
    client = _build_client(tmp_path, monkeypatch)

    anonymous = client.get("/api/mobile/v1/bootstrap")

    assert anonymous.status_code == 200
    assert anonymous.get_json() == {
        "ok": True,
        "data": {
            "contract_version": 1,
            "auth": {"configured": True, "authenticated": False, "user": None},
        },
    }
    assert anonymous.headers["Cache-Control"] == "no-store"


def test_mobile_login_creates_restorable_cookie_and_csrf_session(tmp_path: Path, monkeypatch):
    client = _build_client(tmp_path, monkeypatch)

    login = client.post(
        "/api/mobile/v1/session",
        json={"username": "admin", "password": "secret123"},
    )

    assert login.status_code == 200
    payload = login.get_json()
    assert payload["ok"] is True
    assert payload["data"]["session"]["user"] == "admin"
    csrf_token = payload["data"]["session"]["csrf_token"]
    assert csrf_token
    assert login.headers.getlist("Set-Cookie")

    restored = client.get("/api/mobile/v1/bootstrap")
    assert restored.get_json()["data"]["auth"] == {
        "configured": True,
        "authenticated": True,
        "user": "admin",
    }

    rejected_logout = client.delete("/api/mobile/v1/session")
    assert rejected_logout.status_code == 403

    logout = client.delete(
        "/api/mobile/v1/session",
        headers={"X-CSRF-Token": csrf_token},
    )
    assert logout.status_code == 200
    assert logout.get_json() == {"ok": True, "data": {"session": {"closed": True}}}
    assert client.get("/api/mobile/v1/bootstrap").get_json()["data"]["auth"]["authenticated"] is False


def test_mobile_login_uses_same_setup_and_credential_errors(tmp_path: Path, monkeypatch):
    client = _build_client(tmp_path, monkeypatch, configured=False)

    setup_required = client.post(
        "/api/mobile/v1/session",
        json={"username": "admin", "password": "secret123"},
    )
    assert setup_required.status_code == 428
    assert setup_required.get_json()["error"]["code"] == "not_configured"

    configured_client = _build_client(tmp_path / "configured", monkeypatch)
    invalid = configured_client.post(
        "/api/mobile/v1/session",
        json={"username": "admin", "password": "wrong"},
    )
    assert invalid.status_code == 401
    assert invalid.get_json()["error"]["code"] == "invalid_credentials"
