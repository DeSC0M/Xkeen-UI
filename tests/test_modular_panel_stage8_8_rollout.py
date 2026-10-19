from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "docs" / "modular-panel-stage8-recovery-rollout.md"
REPORT = ROOT / "docs" / "stage8-8" / "recovery-rollout-matrix-2026-10-19.md"
PREFLIGHT = ROOT / "docs" / "stage8-8" / "router-preflight-2026-10-19.json"
COLLECTOR = ROOT / "scripts" / "stage8_8_router_smoke.py"


def test_stage88_rollout_report_preserves_the_stop_decision_and_evidence():
    report = REPORT.read_text(encoding="utf-8")

    for fragment in (
        "**STOP / 8.8 remains open.**",
        "No destructive profile, engine",
        "custom",
        "Mihomo",
        "local build",
        "Signed prerelease evidence",
        "Acceptance matrix",
        "No stable release or rollout claim",
    ):
        assert fragment in report
    assert PREFLIGHT.is_file()


def test_stage88_collector_is_documented_as_read_only():
    runbook = RUNBOOK.read_text(encoding="utf-8")
    source = COLLECTOR.read_text(encoding="utf-8")

    assert "scripts/stage8_8_router_smoke.py" in runbook
    assert "только GET" in runbook
    assert "operation_apply" not in source
    assert '"/api/modules/operations/apply"' not in source
    assert '"/api/modules/profile"' not in source
    assert '"/api/modules/restart"' not in source
