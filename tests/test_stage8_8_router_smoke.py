from __future__ import annotations

import importlib.util
from pathlib import Path


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


def test_router_smoke_redacts_router_address_and_uses_only_fixed_ssh_command():
    smoke = _load()
    assert smoke._redacted_url("http://192.168.1.1:8088/") == "http://<router>/"
    assert "cat /opt/etc/xkeen-ui/BUILD.json" in smoke.SSH_READ_ONLY_COMMAND
    assert "rm " not in smoke.SSH_READ_ONLY_COMMAND
    assert "restart" not in smoke.SSH_READ_ONLY_COMMAND
