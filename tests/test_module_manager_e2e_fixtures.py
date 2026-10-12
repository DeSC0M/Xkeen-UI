"""The server answers the browser tests of the Modules window are stubbed with.

They are taken from the lifecycle service by a script and kept in a file. The
file must be what the script writes today: a stub of yesterday's shape lets a
window pass its tests and break on a router.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate_module_manager_e2e_fixtures.py"
FIXTURES = ROOT / "e2e" / "fixtures" / "module_manager_server.json"
SPEC = ROOT / "e2e" / "modules_manager.spec.mjs"
REGENERATE = "python scripts/generate_module_manager_e2e_fixtures.py"


def _stored() -> dict:
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


def test_stored_answers_are_what_the_service_gives_today(tmp_path):
    out = tmp_path / "module_manager_server.json"
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--json-out", str(out)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
    assert json.loads(out.read_text(encoding="utf-8")) == _stored(), f"run: {REGENERATE}"


def test_stored_answers_keep_the_shape_hand_written_stubs_got_wrong():
    stored = _stored()

    # No operation yet is "no result", not a result called "idle".
    assert stored["status_none"]["result"] is None
    committed = stored["install_committed"]
    assert [entry["step"] for entry in committed["log"]] == [
        "prepared", "downloading", "verifying", "applying", "state", "restarting", "health", "committed",
    ]
    assert list(stored["install_steps"]) == [entry["step"] for entry in committed["log"]]
    assert all(isinstance(entry["at"], float) for entry in committed["log"])
    assert isinstance(committed["started_at"], float)
    plan = stored["install_plan"]
    assert set(plan["dependency_diff"]) == {"requires", "missing", "conflicts", "required_by"}
    assert all(isinstance(path, str) for path in plan["files_add"])
    # A restart is asked of the owner only after an undo under a running panel.
    assert "restart_required" not in committed
    assert stored["rolled_back_restart"]["restart_required"] is True
    assert stored["rolled_back_restart"]["result"] == "rolled_back"
    assert stored["rollback_failed"]["failed_path"]
    assert stored["installed"]["editor"]["variant"] in stored["installed"]["editor"]["available_variants"]
    assert all(item.get("name") for item in stored["available"]["modules"])
    assert stored["rolled_back_restart"]["module_id"] not in stored["installed"]["installed_module_ids"]
    assert stored["installed"]["module_names"][stored["rolled_back_restart"]["module_id"]]


def test_browser_tests_read_the_stored_answers():
    spec = SPEC.read_text(encoding="utf-8")

    assert "fixtures/module_manager_server.json" in spec
    # A server answer written by hand at the top of the file is how it began.
    assert "const installedSnapshot = {" not in spec
    assert "result: 'idle'" not in spec
