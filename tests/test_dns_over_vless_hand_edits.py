"""Ручные правки служебных объектов DNS-over-VLESS.

Пользователь дописал в служебный фрагмент больше восьми серверов, панель
перестала узнавать свой файл, и в окне не работала ни одна кнопка. Здесь —
что панель читает своим, что перечисляет как правку и как из правки выйти.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.cores import CoreRuntime
from services import dns_over_vless as dns
from tests.test_dns_over_vless import _base_config, _write


@pytest.fixture(autouse=True)
def _isolate_jsonc_sidecars(monkeypatch):
    monkeypatch.setattr(dns, "jsonc_path_for", lambda path: str(path) + "c")


SERVERS = [f"9.9.9.{n}" for n in range(1, 21)]


def _enabled(tmp_path: Path, fragment: dict | None = None):
    configs, routing_path, state = _base_config(tmp_path)
    routing = json.loads(routing_path.read_text(encoding="utf-8"))
    target = dns._select_target(dns._collect_runtime(str(configs), routing), "proxy")
    _write(configs / dns.MANAGED_FRAGMENT, fragment or dns._managed_fragment())
    _write(routing_path, dns._build_enabled_routing(routing, target))
    _write(
        state / dns.STATE_FILENAME,
        {"enabled": True, "original_dns_override": False, "upstreams": ["8.8.8.8"]},
    )
    return configs, routing_path, state


def _status(monkeypatch, configs, routing_path, state):
    monkeypatch.setattr(dns, "core_runtime", lambda: CoreRuntime(("xray",)))
    monkeypatch.setattr(dns, "_dns_override_status", lambda: (True, "test"))
    return dns.get_status(
        configs_dir=str(configs), routing_file=str(routing_path), ui_state_dir=str(state)
    )


def _disable(monkeypatch, configs, routing_path, state, **kwargs):
    monkeypatch.setattr(dns, "_stage_and_test", lambda *_a, **_k: {"ok": True})
    monkeypatch.setattr(dns, "_wait_for_xray", lambda *_a, **_k: True)
    monkeypatch.setattr(dns, "_wait_for_port_53", lambda *_a, **_k: True)
    monkeypatch.setattr(dns, "_set_dns_override", lambda _enabled: None)
    monkeypatch.setattr(
        dns, "_write_routing_preserving_comments", lambda path, obj, **_k: _write(Path(path), obj)
    )
    return dns.apply_action(
        "disable",
        configs_dir=str(configs),
        routing_file=str(routing_path),
        ui_state_dir=str(state),
        restart_xkeen=lambda **_k: True,
        **kwargs,
    )


def test_panel_writes_up_to_sixteen_servers():
    assert dns.MAX_UPSTREAMS == 16
    assert dns.validate_upstreams(SERVERS[:16]) == SERVERS[:16]
    with pytest.raises(dns.DnsOverVlessError):
        dns.validate_upstreams(SERVERS[:17])


def test_fragment_extended_past_the_cap_by_hand_is_still_the_panels_own(tmp_path, monkeypatch):
    # Ровно случай пользователя: серверы дописаны руками сверх предела записи.
    configs, routing_path, state = _enabled(tmp_path, dns._managed_fragment(SERVERS))

    result = _status(monkeypatch, configs, routing_path, state)

    assert result["tampered"] is False
    assert result["partial"] is False
    assert result["enabled"] is True
    assert result["can_disable"] is True
    # Окно показывает серверы, которые действуют, а не прежние из настроек.
    assert result["upstreams"] == SERVERS
    assert result["max_upstreams"] == 16


def test_disable_keeps_the_servers_added_by_hand(tmp_path, monkeypatch):
    configs, routing_path, state = _enabled(tmp_path, dns._managed_fragment(SERVERS[:11]))
    monkeypatch.setattr(dns, "core_runtime", lambda: CoreRuntime(("xray",)))
    monkeypatch.setattr(dns, "_dns_override_status", lambda: (True, "test"))

    _disable(monkeypatch, configs, routing_path, state)

    saved = json.loads((state / dns.STATE_FILENAME).read_text(encoding="utf-8"))
    assert saved["upstreams"] == SERVERS[:11]


def test_hand_edit_is_listed_with_file_field_and_zone(tmp_path, monkeypatch):
    fragment = dns._managed_fragment(["8.8.8.8"])
    fragment["dns"]["servers"].append("dns.google")
    configs, routing_path, state = _enabled(tmp_path, fragment)
    routing = json.loads(routing_path.read_text(encoding="utf-8"))
    for rule in routing["routing"]["rules"]:
        if rule.get("ruleTag") == dns.PROXY_RULE_TAG:
            rule.pop("balancerTag", None)
            rule["outboundTag"] = "direct"
    _write(routing_path, routing)

    result = _status(monkeypatch, configs, routing_path, state)

    assert result["tampered"] is True
    assert result["can_disable"] is False
    assert result["can_discard_edits"] is True
    # Защиту включала панель: сторож следит, хотя окно её включённой не зовёт.
    assert result["enabled"] is False
    assert result["guard_watching"] is True
    details = result["tamper_details"]
    servers = [item for item in details if item["zone"] == "servers"]
    route = [item for item in details if item["zone"] == "route"]
    assert servers and dns.MANAGED_FRAGMENT in servers[0]["text"] and "dns.google" in servers[0]["text"]
    assert route and dns.PROXY_RULE_TAG in route[0]["text"] and "«direct»" in route[0]["text"]
    assert "05_routing.json" in route[0]["text"]
    # «Прерванная операция» тут была бы неправдой: операция не прерывалась.
    assert not any("неполная предыдущая" in item for item in result["blockers"])


def test_edited_field_is_named_by_its_path(tmp_path, monkeypatch):
    fragment = dns._managed_fragment(["8.8.8.8"])
    fragment["dns"]["queryStrategy"] = "UseIPv4"
    configs, routing_path, state = _enabled(tmp_path, fragment)

    details = _status(monkeypatch, configs, routing_path, state)["tamper_details"]

    assert any("dns.queryStrategy" in item["text"] and '"UseIPv4"' in item["text"] for item in details)


def test_unreadable_fragment_is_reported_as_such(tmp_path, monkeypatch):
    configs, routing_path, state = _enabled(tmp_path)
    (configs / dns.MANAGED_FRAGMENT).write_text("{ broken", encoding="utf-8")

    details = _status(monkeypatch, configs, routing_path, state)["tamper_details"]

    assert any("не читается как JSON" in item["text"] for item in details)


def test_untouched_config_lists_nothing(tmp_path, monkeypatch):
    configs, routing_path, state = _enabled(tmp_path)

    result = _status(monkeypatch, configs, routing_path, state)

    assert result["tampered"] is False
    assert result["can_discard_edits"] is False
    assert result["tamper_details"] == []
    assert result["guard_watching"] is True


def test_guard_is_not_watching_what_was_never_enabled(tmp_path, monkeypatch):
    configs, routing_path, state = _base_config(tmp_path)

    assert _status(monkeypatch, configs, routing_path, state)["guard_watching"] is False


def test_plain_disable_still_refuses_hand_edits(tmp_path, monkeypatch):
    fragment = dns._managed_fragment(["8.8.8.8"])
    fragment["dns"]["queryStrategy"] = "UseIPv4"
    configs, routing_path, state = _enabled(tmp_path, fragment)
    monkeypatch.setattr(dns, "core_runtime", lambda: CoreRuntime(("xray",)))
    monkeypatch.setattr(dns, "_dns_override_status", lambda: (True, "test"))

    with pytest.raises(dns.DnsOverVlessError) as exc:
        _disable(monkeypatch, configs, routing_path, state)

    assert exc.value.code == "managed_config_modified"
    assert (configs / dns.MANAGED_FRAGMENT).exists()


def test_discarding_edits_removes_only_the_panels_objects(tmp_path, monkeypatch):
    fragment = dns._managed_fragment(["8.8.8.8"])
    fragment["dns"]["queryStrategy"] = "UseIPv4"
    configs, routing_path, state = _enabled(tmp_path, fragment)
    original = json.loads(routing_path.read_text(encoding="utf-8"))
    # Правило человека рядом со служебными должно пережить удаление правок.
    original["routing"]["rules"].append({"type": "field", "domain": ["example.com"], "outboundTag": "proxy-a"})
    _write(routing_path, original)
    monkeypatch.setattr(dns, "core_runtime", lambda: CoreRuntime(("xray",)))
    monkeypatch.setattr(dns, "_dns_override_status", lambda: (True, "test"))

    result = _disable(monkeypatch, configs, routing_path, state, discard_edits=True)

    assert result["ok"] is True
    assert result["discarded_edits"] is True
    assert not (configs / dns.MANAGED_FRAGMENT).exists()
    left = json.loads(routing_path.read_text(encoding="utf-8"))["routing"]
    assert not any(dns._owned_rule(rule) for rule in left["rules"])
    assert {"type": "field", "domain": ["example.com"], "outboundTag": "proxy-a"} in left["rules"]
    assert not any(item.get("tag") == dns.BALANCER_TAG for item in left["balancers"])
    assert json.loads((state / dns.STATE_FILENAME).read_text(encoding="utf-8"))["enabled"] is False


def test_discard_flag_must_be_an_explicit_true(tmp_path, monkeypatch):
    fragment = dns._managed_fragment(["8.8.8.8"])
    fragment["dns"]["queryStrategy"] = "UseIPv4"
    configs, routing_path, state = _enabled(tmp_path, fragment)
    monkeypatch.setattr(dns, "core_runtime", lambda: CoreRuntime(("xray",)))
    monkeypatch.setattr(dns, "_dns_override_status", lambda: (True, "test"))

    with pytest.raises(dns.DnsOverVlessError):
        _disable(monkeypatch, configs, routing_path, state, discard_edits="yes")


def test_http_route_forwards_only_an_explicit_true(tmp_path, monkeypatch):
    from flask import Flask
    from routes.routing import dns_over_vless as dns_routes

    configs, routing_path, state = _base_config(tmp_path)
    seen: dict = {}

    def fake_apply(action, **kwargs):
        seen.update(kwargs)
        return {"ok": True, "action": action, "discarded_edits": bool(kwargs.get("discard_edits"))}

    monkeypatch.setattr(dns_routes, "apply_action", fake_apply)
    app = Flask(__name__)
    app.config["WTF_CSRF_ENABLED"] = False
    dns_routes.register_dns_over_vless_routes(
        app,
        xray_configs_dir=str(configs),
        routing_file=str(routing_path),
        ui_state_dir=str(state),
        restart_xkeen=lambda **_kwargs: True,
    )
    client = app.test_client()

    assert client.post("/api/routing/dns-over-vless", json={"action": "disable", "discard_edits": True}).status_code == 200
    assert seen["discard_edits"] is True
    client.post("/api/routing/dns-over-vless", json={"action": "disable", "discard_edits": "true"})
    assert seen["discard_edits"] is False
    client.post("/api/routing/dns-over-vless", json={"action": "disable"})
    assert seen["discard_edits"] is False
