from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def run_model(code: str):
    if not shutil.which("node"):
        pytest.skip("node is unavailable")
    result = subprocess.run(
        ["node", "--input-type=module"],
        input=(
            "import { metricNumber, selectHistory, nearestPointIndex, resourceHealth, "
            "buildResourceSnapshot, collectionGap, historyGaps, gapAtTime, selectClients } from './xkeen-ui/static/js/features/resource_monitor_model.js';\n"
            + code
        ),
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_absent_metrics_never_turn_into_zero():
    assert run_model(
        "console.log(JSON.stringify([null, undefined, '', false, 'oops', -1, Infinity, 0, '0', 12.5].map(metricNumber)));"
    ) == [None, None, None, None, None, None, None, 0, 0, 12.5]


def test_history_range_uses_timestamps_not_assumed_poll_cadence():
    assert run_model("""
const points = [0, 5, 15, 300, 330, 600].map(at => ({at}));
console.log(JSON.stringify({
  selected: selectHistory(points, 5).map(p => p.at),
  nearest: [0, 301, 580].map(at => nearestPointIndex(points, at)),
  empty: selectHistory([], 5),
}));
""") == {"selected": [300, 330, 600], "nearest": [0, 3, 5], "empty": []}


def test_health_uses_connection_and_conntrack_and_preserves_unknown_state():
    result = run_model("""
const normal = {
  cpu: {percent: 5}, memory: {percent: 45},
  router: {internet: {available: true, internet: true, gateway: true, dns: true, captive: true}},
};
console.log(JSON.stringify({
  normal: resourceHealth(normal),
  missing: resourceHealth({cpu: {percent: 1}, memory: {percent: 1}}),
  stale: resourceHealth({...normal, router: {...normal.router, freshness: {state: 'stale'}}}),
  conntrack: resourceHealth({...normal, router: {...normal.router, conntrack: {available: true, percent: 96}}}),
  captive: resourceHealth({...normal, router: {internet: {...normal.router.internet, captive: false}}}),
  dns: resourceHealth(normal, {state: 'error'}),
}));
""")
    assert result["normal"]["tone"] == "normal"
    assert result["missing"]["tone"] == "unknown"
    assert result["stale"]["tone"] == "unknown"
    assert result["conntrack"]["tone"] == "danger"
    assert "Conntrack" in result["conntrack"]["note"]
    assert "авторизация" in result["captive"]["note"]
    assert result["dns"]["title"] == "Проблема с зашифрованным DNS"


def test_snapshot_has_explicit_allowlist_and_filters_selected_interval():
    result = run_model("""
const payload = {
  sampled_at: 600, cpu: {percent: 2, secret: 'TOKEN'},
  memory: {percent: 30}, storage: {path: '/secret/path'},
  network: {received_bytes: 42, interfaces: [{name: 'private', address: '192.0.2.1'}]},
  router: {internet: {address: '192.0.2.1'}, clients: [{mac: 'secret'}]},
  logs: 'PRIVATE', ui_process: {pid: 99},
};
const history = [{at: 0, cpu: 1, address: 'PRIVATE'}, {at: 600, cpu: 2, token: 'TOKEN'}];
console.log(JSON.stringify(buildResourceSnapshot(payload, history, 5, 0, true)));
""")
    text = json.dumps(result)
    for private in ["TOKEN", "PRIVATE", "/secret/path", "192.0.2.1", "private", "router", "ui_process"]:
        assert private not in text
    assert result["resources"]["network"]["received_bytes"] == 42
    assert result["history"][0]["at"] == 600
    assert len(result["history"]) == 1
    assert result["stale"] is True
    assert result["refresh_seconds"] == 0


def test_background_poll_and_return_to_foreground_do_not_make_false_gaps():
    result = run_model("""
const points = [{at: 100, period: 5}, {at: 130, period: 30}, {at: 160, period: 5}, {at: 165, period: 5}];
const outage = [...points, {at: 225, period: 5}];
console.log(JSON.stringify({
  background: historyGaps(points),
  outage: historyGaps(outage),
  hoverGap: gapAtTime(outage, 200),
  hoverMeasured: gapAtTime(outage, 225),
}));
""")
    assert result["background"] == []
    assert result["outage"] == [{"from": 165, "to": 225, "seconds": 60}]
    assert result["hoverGap"] == result["outage"][0]
    assert result["hoverMeasured"] is None


def test_clients_toggle_uses_cached_full_list_and_keeps_top_five_limit():
    result = run_model("""
const items = Array.from({length: 12}, (_, index) => ({name: `client-${index}`}));
const payload = {items, top: items.slice(0, 5)};
console.log(JSON.stringify({
  top: selectClients(payload, false).length,
  all: selectClients(payload, true).length,
  absent: selectClients(null, true),
  bounded: selectClients({items: Array(120).fill({})}, true).length,
}));
""")
    assert result == {"top": 5, "all": 12, "absent": [], "bounded": 100}
