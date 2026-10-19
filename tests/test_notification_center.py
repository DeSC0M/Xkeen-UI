from __future__ import annotations

import json
from pathlib import Path

from services.module_update_channel import write_channel
from services.notification_center import NotificationCenter


class FakeLifecycle:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def notification_catalog(self, *, force_refresh=False):
        self.calls.append(bool(force_refresh))
        return dict(self.payload)


def _payload(channel="stable"):
    return {
        "ok": True,
        "channel": channel,
        "source_version": "2.10.0",
        "target_version": "2.11.0",
        "update_available": True,
        "requires_installer": False,
        "min_updater": None,
        "freshness": "fresh",
        "stale_reason": None,
        "fetched_at": 1_000.0,
        "installed_module_ids": ["core", "engine.xray"],
        "current_modules": [
            {
                "id": "engine.xray",
                "version": "2.10.0",
                "requires": ["core"],
                "conflicts": [],
            }
        ],
        "target_modules": [
            {
                "id": "engine.xray",
                "version": "2.11.0",
                "size": 1234,
                "requires": ["core", "tool.editor"],
                "conflicts": [],
                "requires_restart": True,
            },
            {
                "id": "tool.terminal",
                "version": "2.11.0",
                "size": 5678,
                "requires": ["core"],
                "conflicts": [],
                "requires_restart": True,
            },
        ],
        "target_panel": {"size": 9999},
        "baseline_error": None,
    }


def test_notification_center_deduplicates_and_persists_local_state(tmp_path: Path):
    lifecycle = FakeLifecycle(_payload())
    center = NotificationCenter(lifecycle, state_dir=tmp_path, now=lambda: 2_000.0)

    first = center.check(force_refresh=True)
    assert lifecycle.calls == [True]
    assert first["unread_count"] == 3
    kinds = {record["kind"] for record in first["records"]}
    assert kinds == {"panel-update", "module-update", "module-new"}

    record_id = next(record["id"] for record in first["records"] if record["kind"] == "module-update")
    center.set_record_state(record_id, "dismiss")
    second = center.check(force_refresh=False)
    assert lifecycle.calls == [True, False]
    assert second["unread_count"] == 2
    assert record_id not in {record["id"] for record in second["records"]}

    raw = json.loads((tmp_path / "module-notifications.json").read_text(encoding="utf-8"))
    assert raw["schema_version"] == 1
    assert raw["records"][record_id]["dismissed_at"] == 2_000.0


def test_notification_center_keeps_stale_catalog_and_exposes_retry(tmp_path: Path):
    payload = _payload()
    lifecycle = FakeLifecycle(payload)
    now = [2_000.0]
    center = NotificationCenter(lifecycle, state_dir=tmp_path, now=lambda: now[0])
    center.check()

    def unavailable(*, force_refresh=False):
        error = ValueError("offline")
        error.code = "catalog_unavailable"
        raise error

    lifecycle.notification_catalog = unavailable
    now[0] = 3_000.0
    result = center.check(force_refresh=True)
    assert result["status"]["error_code"] == "catalog_unavailable"
    assert any(record["kind"] == "catalog-error" for record in result["records"])
    assert any(record["kind"] == "panel-update" for record in result["records"])


def test_notification_center_channel_state_isolated(tmp_path: Path):
    lifecycle = FakeLifecycle(_payload())
    center = NotificationCenter(lifecycle, state_dir=tmp_path, now=lambda: 2_000.0)
    center.check()
    write_channel(tmp_path, "prerelease")
    lifecycle.payload = _payload("prerelease")

    result = center.snapshot()
    assert result["channel"] == "prerelease"
    assert result["records"] == []
    assert result["unread_count"] == 0

    result = center.check()
    assert result["channel"] == "prerelease"
    assert result["unread_count"] == 3
