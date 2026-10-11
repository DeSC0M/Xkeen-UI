"""Форма подписки не предлагает балансировщик, который панель строит сама.

`xk-dns-over-vless` — копия маршрута, снятая DNS-over-VLESS при включении.
Отметь его владелец в «Найденных балансировщиках», подписка дописала бы в него
свои узлы и убрала бы их при удалении: объект DNS-over-VLESS разошёлся бы с
тем, что панель записала о нём у себя.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "xkeen-ui"))

from services import dns_over_vless as dov  # noqa: E402
from services import xray_subscriptions as subs  # noqa: E402


def _routing(configs: Path) -> None:
    configs.mkdir(parents=True, exist_ok=True)
    (configs / "05_routing.json").write_text(
        json.dumps(
            {
                "routing": {
                    "balancers": [
                        {"tag": "proxy", "selector": ["vps_"], "strategy": {"type": "leastPing"}},
                        {"tag": dov.BALANCER_TAG, "selector": ["vps_"], "strategy": {"type": "random"}},
                    ],
                    "rules": [],
                }
            }
        ),
        encoding="utf-8",
    )


def test_panel_owned_tags_follow_dns_over_vless():
    assert subs.PANEL_OWNED_BALANCER_TAGS == frozenset({dov.BALANCER_TAG})


def test_listing_hides_the_dns_over_vless_balancer(tmp_path: Path):
    configs = tmp_path / "configs"
    _routing(configs)

    tags = [item["tag"] for item in subs.list_subscription_routing_balancers(str(configs))]

    assert tags == ["proxy"]


def test_saving_ignores_the_dns_over_vless_balancer(tmp_path: Path):
    saved = subs.upsert_subscription(
        str(tmp_path),
        {
            "url": "https://example.test/sub",
            "tag": "vps",
            "routing_balancer_tags": ["proxy", dov.BALANCER_TAG],
        },
    )

    stored = subs.list_subscriptions(str(tmp_path))[0]
    assert stored["routing_balancer_tags"] == ["proxy"]
    assert dov.BALANCER_TAG not in json.dumps(saved)
