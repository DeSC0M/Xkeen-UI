"""Answers of the module lifecycle service for the browser tests of the Modules window.

The browser tests stub ``/api/modules/*``. Stubs written by hand drift from
what the server sends: a step the runner never names, whole seconds, a
dependency diff of another shape. Here the answers are taken from the service
itself: a small panel is laid in a temporary folder, a module is really
installed into it, a runner is "killed" halfway, an undo is made to fail.

Every answer is what ``ModuleLifecycleService`` returned. The clock is replaced
with a counted one, and the few values that depend on the machine rather than
on the code (see ``_pin``) are replaced with stand-ins of the same type, so the
file is the same on every run and on every system.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = "e2e/fixtures/module_manager_server.json"
OPERATION_ID = "20261006T120000Z-abcdef"
NEXT_VERSION = "2.11.0"
INSTALLED = ("core", "tool.editor", "engine.mihomo")
TARGET = "tool.terminal"
# 2026-10-08 12:39:02 UTC and a fraction: the server speaks in float seconds.
CLOCK_START = 1791463142.1234567
CLOCK_STEP = 0.37


class _RunnerKilled(BaseException):
    """The runner is gone mid-step: nothing of its own cleanup runs."""


class _Clock:
    def __init__(self) -> None:
        self.now = CLOCK_START

    def __call__(self) -> float:
        self.now += CLOCK_STEP
        return self.now


def _import_paths(root: Path) -> None:
    for entry in (root, root / "xkeen-ui"):
        if str(entry) not in sys.path:
            sys.path.insert(0, str(entry))


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _panel(tmp: Path, name: str):
    """A released panel with Mihomo installed and switched off, as after a restart."""

    from services.module_registry import ModuleRegistry
    from tests.support.module_tx import make_panel

    panel = make_panel(tmp / name, installed=INSTALLED)
    for relative in ("modules.json", "install-profile.json"):
        record = panel.read_json(relative)
        record["profile"] = "mihomo-minimal"
        _write_json(panel.path(relative), record)
    registry = ModuleRegistry(str(panel.state), which=lambda _name: "/bin/tool")
    registry.set_enabled("engine.mihomo", False)
    # The panel has been restarted since: the switch is no longer pending.
    registry.initialize_for_startup()
    return panel, registry


def _service(panel, registry, release):
    from services.module_transactions.state import read_status
    from tests.support.module_lifecycle import make_service

    # The runner of these scenarios lives in this very process, so the status
    # is read as it lies: the launcher would take a live runner for a dead one.
    service, recorder = make_service(
        panel, release, registry=registry, observe_operation=lambda _root, state: read_status(state)
    )
    recorder.client._now = time.time
    return service


def _run(panel, release, operation: str, *, on_step: Callable[[str], None] | None = None, healthy: bool = True) -> str:
    from services.module_transactions.executor import run_operation
    from services.module_transactions.journal import Journal
    from services.module_transactions.plan import build_plan
    from tests.support.module_tx import ARCHITECTURE

    plan = build_plan(operation, TARGET, **{**panel.kwargs, "catalog": release.catalog})
    journal = Journal.create(panel.root, plan, OPERATION_ID, extra={})
    client = release.client(panel.state)
    client._now = time.time
    return run_operation(
        journal,
        state_dir=panel.state,
        client=client,
        architecture=ARCHITECTURE,
        restart=lambda: None,
        wait_healthy=lambda _phase: healthy,
        on_step=on_step,
    )


def _killed_at(panel, release, step: str) -> None:
    def kill(current: str) -> None:
        if current == step:
            raise _RunnerKilled()

    try:
        _run(panel, release, "install", on_step=kill)
    except _RunnerKilled:
        return
    raise RuntimeError(f"the operation never reached the step {step}")


def _digest(*parts: Any) -> str:
    return hashlib.sha256(":".join(str(part) for part in parts).encode("utf-8")).hexdigest()


def _pin(value: Any) -> Any:
    """Stand-ins for what the machine decides, not the code.

    The packed size and the checksum of an archive follow the compression
    library; the digest of a plan and the room it asks for follow them. The
    size of an installed module is a table that changes with every build.
    """

    if isinstance(value, list):
        return [_pin(item) for item in value]
    if not isinstance(value, dict):
        return value
    pinned = {key: _pin(item) for key, item in value.items()}
    if isinstance(pinned.get("sha256"), str):
        pinned["sha256"] = _digest(pinned.get("archive"))
    if isinstance(pinned.get("size"), int) and "archive" in pinned:
        pinned["size"] = 4096
    if isinstance(pinned.get("size_bytes"), int):
        pinned["size_bytes"] = 1 << 20
    if isinstance(pinned.get("plan_id"), str):
        pinned["plan_id"] = _digest(pinned.get("operation"), pinned.get("module_id"), pinned.get("version"))
    if isinstance(pinned.get("required_free_bytes"), int) and pinned["required_free_bytes"] > 0:
        pinned["required_free_bytes"] = 12 << 20
    return pinned


def build_fixtures() -> dict[str, Any]:
    _import_paths(ROOT)
    from services.module_transactions import journal as journal_module
    from services.module_transactions.executor import OperationCancelled
    from services.module_transactions.state import ModuleTransactionError
    from tests.support.module_tx import make_release

    with tempfile.TemporaryDirectory(prefix="xk-module-fixtures-") as raw, mock.patch("time.time", _Clock()):
        tmp = Path(raw)
        release = make_release()
        fixtures: dict[str, Any] = {}

        # A quiet panel, then one installation watched step by step.
        panel, registry = _panel(tmp, "install")
        service = _service(panel, registry, release)
        fixtures["installed"] = service.installed()
        fixtures["available"] = service.available()
        fixtures["status_none"] = service.status()
        fixtures["install_plan"] = service.plan("install", TARGET)
        fixtures["update_check_current"] = service.panel_update_check()
        fixtures["panel_update_current"] = service.plan("panel-update", None)
        steps: dict[str, Any] = {}
        _run(panel, release, "install", on_step=lambda step: steps.setdefault(step, service.status()))
        fixtures["install_steps"] = steps
        fixtures["install_committed"] = service.status()
        fixtures["installed_after_install"] = service.installed()
        fixtures["available_after_install"] = service.available()

        # The runner died while it was still downloading: nothing was touched.
        panel, registry = _panel(tmp, "interrupted")
        service = _service(panel, registry, release)
        _killed_at(panel, release, "downloading")
        fixtures["recovery_interrupted"] = service.recover()
        fixtures["interrupted"] = service.status()

        # The owner pressed "cancel" while the archive was coming down.
        panel, registry = _panel(tmp, "cancelled")
        service = _service(panel, registry, release)

        def cancel(step: str) -> None:
            if step == "downloading":
                raise OperationCancelled()

        _run(panel, release, "install", on_step=cancel)
        fixtures["cancelled"] = service.status()

        # The runner died after it had restarted the panel: the files are put
        # back under a running panel, which now has to be restarted.
        panel, registry = _panel(tmp, "rolled-back")
        service = _service(panel, registry, release)
        _killed_at(panel, release, "health")
        fixtures["recovery_rolled_back"] = service.recover()
        fixtures["rolled_back_restart"] = service.status()

        # The panel did not come up and the previous files could not be put back.
        panel, registry = _panel(tmp, "rollback-failed")
        service = _service(panel, registry, release)

        def failing_rollback(_journal) -> None:
            raise ModuleTransactionError(
                "operation_rollback_failed", "cannot restore", path="services/ws_pty.py", error="Read-only file system"
            )

        with mock.patch.object(journal_module.Journal, "rollback", failing_rollback):
            _run(panel, release, "install", healthy=False)
        fixtures["rollback_failed"] = service.status()

        # The owner switched Mihomo on: the panel waits for a restart.
        panel, registry = _panel(tmp, "switched")
        service = _service(panel, registry, release)
        registry.set_enabled("engine.mihomo", True)
        fixtures["installed_mihomo_on"] = service.installed()

        # The same panel when a later release is out.
        panel, registry = _panel(tmp, "update")
        service = _service(panel, registry, make_release(version=NEXT_VERSION))
        fixtures["update_check"] = service.panel_update_check()
        fixtures["panel_update_plan"] = service.plan("panel-update", None)

    return _pin(fixtures)


def render(fixtures: dict[str, Any]) -> str:
    return json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json-out", type=Path, default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out = args.json_out or ROOT / DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(build_fixtures()), encoding="utf-8", newline="\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
