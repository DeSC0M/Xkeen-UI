"""Снимки транзакций DNS-over-VLESS не копятся.

Снимок нужен только для отката внутри той операции, что его сделала: интерфейс
их не показывает, откатиться по ним нельзя.  На роутерах 45.1 и 10.1 к
29.09.2026 набралось по 60–70 каталогов, к 16.10.2026 — по 3–5 после урезания
до 10.  Теперь снимок удачной операции удаляется сразу, а неудачной остаётся
для разбора — не больше ``FAILED_TRANSACTIONS_KEEP``.  В состоянии на снимок
больше не ссылаемся: ``last_transaction`` только писался, читать его было некому.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.cores import CoreRuntime
from services import dns_over_vless as dns
from tests.test_dns_over_vless import _isolate_jsonc_sidecars, _scenario_config, _write  # noqa: F401


def _tx_dir(state: Path) -> Path:
    return state / "dns-over-vless" / "transactions"


def _transactions(state: Path) -> list[str]:
    root = _tx_dir(state)
    return sorted(p.name for p in root.iterdir()) if root.is_dir() else []


@pytest.fixture
def stand(tmp_path: Path, monkeypatch):
    configs, routing_path, state = _scenario_config(tmp_path)
    monkeypatch.setattr(dns, "core_runtime", lambda: CoreRuntime(("xray",)))
    monkeypatch.setattr(dns, "_dns_override_status", lambda: (False, "test"))
    monkeypatch.setattr(dns, "_stage_and_test", lambda *_a, **_k: {"ok": True})
    monkeypatch.setattr(dns, "_wait_for_xray", lambda *_a, **_k: True)
    monkeypatch.setattr(dns, "_wait_for_port_53", lambda *_a, **_k: True)
    monkeypatch.setattr(dns, "_dns_probe", lambda *_a, **_k: {"ok": True, "answers": 1})
    monkeypatch.setattr(dns, "_set_dns_override", lambda enabled: None)
    monkeypatch.setattr(dns, "_write_routing_preserving_comments", lambda path, obj, **_kwargs: _write(Path(path), obj))

    def run(action: str, *, restart_ok: bool = True):
        return dns.apply_action(
            action,
            configs_dir=str(configs),
            routing_file=str(routing_path),
            ui_state_dir=str(state),
            restart_xkeen=lambda **_k: restart_ok,
            target_tag="balancer_main",
            upstreams=["1.1.1.1"],
        )

    return run, state


def _state(state: Path) -> dict:
    return json.loads(Path(dns._state_path(str(state))).read_text(encoding="utf-8"))


def test_a_successful_operation_leaves_no_snapshot(stand):
    run, state = stand

    run("enable")
    assert _transactions(state) == []
    run("disable")
    assert _transactions(state) == []


def test_the_state_no_longer_points_at_a_snapshot(stand):
    run, state = stand

    run("enable")
    assert "last_transaction" not in _state(state)
    run("disable")
    assert "last_transaction" not in _state(state)


def test_an_old_pointer_is_dropped_on_the_next_write(stand):
    run, state = stand
    run("enable")
    path = Path(dns._state_path(str(state)))
    document = json.loads(path.read_text(encoding="utf-8"))
    document["last_transaction"] = "/opt/etc/xkeen-ui/dns-over-vless/transactions/20261014-232953-c9669921"
    path.write_text(json.dumps(document), encoding="utf-8")

    run("disable")

    assert "last_transaction" not in _state(state)


def test_a_failed_operation_keeps_its_snapshot_for_inspection(stand):
    run, state = stand

    with pytest.raises(dns.DnsOverVlessError):
        run("enable", restart_ok=False)

    left = _transactions(state)
    assert len(left) == 1
    assert (_tx_dir(state) / left[0] / "manifest.json").is_file()


def test_only_the_latest_failed_snapshots_are_kept(stand):
    run, state = stand
    tx = _tx_dir(state)
    tx.mkdir(parents=True)
    for i in range(6):
        (tx / f"20260801-0000{i:02d}-deadbeef").mkdir()

    with pytest.raises(dns.DnsOverVlessError):
        run("enable", restart_ok=False)

    left = _transactions(state)
    assert len(left) == dns.FAILED_TRANSACTIONS_KEEP
    assert "20260801-000005-deadbeef" in left
    assert "20260801-000000-deadbeef" not in left


def test_prune_leaves_foreign_entries_alone(tmp_path):
    state = tmp_path / "state"
    tx = _tx_dir(state)
    tx.mkdir(parents=True)
    for i in range(dns.FAILED_TRANSACTIONS_KEEP + 3):
        (tx / f"20260801-0000{i:02d}-deadbeef").mkdir()
    (tx / "notes.txt").write_text("keep me", encoding="utf-8")
    (tx / "manual-copy").mkdir()

    dns._prune_transactions(str(state))

    names = {p.name for p in tx.iterdir()}
    assert "notes.txt" in names
    assert "manual-copy" in names
    assert len([n for n in names if n.startswith("2026")]) == dns.FAILED_TRANSACTIONS_KEEP


def test_prune_without_directory_is_quiet(tmp_path):
    dns._prune_transactions(str(tmp_path / "missing"))
