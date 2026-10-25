"""Measure the subscriptions list projection on deterministic, synthetic data.

Run: python scripts/benchmark_xray_subscription_payload.py
No provider requests, production state or router access are used.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xkeen-ui"))
import routes.xray_subscriptions as routes
from flask import Flask


def run():
    records = []
    for count, total_nodes in [(1, 100), (10, 1000), (50, 5000)]:
        subscriptions = []
        for index in range(count):
            nodes = [
                {
                    "key": f"{index}-{node}",
                    "name": f"Germany node {node}",
                    "protocol": "vless",
                    "transport": "tcp",
                    "host": "example.com",
                    "port": 443,
                }
                for node in range(total_nodes // count)
            ]
            baselines = {
                node["key"]: {
                    "tag": node["key"],
                    "protocol": "vless",
                    "settings": {
                        "vnext": [
                            {
                                "address": "example.com",
                                "port": 443,
                                "users": [
                                    {
                                        "id": "00000000-0000-4000-8000-000000000000",
                                        "encryption": "none",
                                    }
                                ],
                            }
                        ]
                    },
                    "streamSettings": {
                        "network": "tcp",
                        "security": "tls",
                        "tlsSettings": {"serverName": "example.com"},
                    },
                }
                for node in nodes
            }
            subscriptions.append(
                {
                    "id": str(index),
                    "url": "https://example.com/sub",
                    "last_nodes": nodes,
                    "last_generated_outbounds": baselines,
                }
            )
        with TemporaryDirectory() as state:
            app = Flask(__name__)
            original = routes.list_subscriptions
            routes.list_subscriptions = lambda _: subscriptions
            try:
                app.register_blueprint(
                    routes.create_xray_subscriptions_blueprint(
                        ui_state_dir=state,
                        xray_configs_dir=state,
                        restart_xkeen=lambda **kw: True,
                        snapshot_xray_config_before_overwrite=lambda path: None,
                    )
                )
                client = app.test_client()
                times, sizes = {}, {}
                for mode, headers in [
                    ("full", {}),
                    ("compact", {"X-Subscriptions-Compact": "1"}),
                ]:
                    samples = []
                    for repeat in range(8):
                        start = perf_counter()
                        response = client.get(
                            "/api/xray/subscriptions", headers=headers
                        )
                        elapsed = (perf_counter() - start) * 1000
                        assert response.status_code == 200
                        if repeat:
                            samples.append(elapsed)
                    times[mode] = round(median(samples), 3)
                    sizes[mode] = len(response.data)
                records.append(
                    {
                        "subscriptions": count,
                        "total_nodes": total_nodes,
                        "full_bytes": sizes["full"],
                        "compact_bytes": sizes["compact"],
                        "reduction_percent": round(
                            (1 - sizes["compact"] / sizes["full"]) * 100, 1
                        ),
                        "full_median_ms": times["full"],
                        "compact_median_ms": times["compact"],
                    }
                )
            finally:
                routes.list_subscriptions = original
    return records


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "method": "Flask test client, synthetic data; 1 warmup + 7 measured requests per mode; no network",
                "results": run(),
            },
            indent=2,
        )
    )
