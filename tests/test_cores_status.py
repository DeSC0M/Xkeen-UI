from __future__ import annotations

import json

from flask import Flask

from services import cores


def test_core_status_does_not_guess_xray_when_process_detection_is_inconclusive(monkeypatch, tmp_path):
    monkeypatch.setattr(cores, "_last_core_path", lambda: str(tmp_path / cores.LAST_CORE_FILENAME))
    monkeypatch.setattr(cores, "detect_available_cores", lambda: ["xray", "mihomo"])
    monkeypatch.setattr(cores, "detect_running_core", lambda: None)

    available, current = cores.get_cores_status()

    assert available == ["xray", "mihomo"]
    assert current is None


def test_the_engine_seen_running_is_remembered_for_a_stopped_service(monkeypatch, tmp_path):
    path = tmp_path / cores.LAST_CORE_FILENAME
    monkeypatch.setattr(cores, "_last_core_path", lambda: str(path))
    monkeypatch.setattr(cores, "detect_available_cores", lambda: ["xray", "mihomo"])
    running = ["mihomo"]
    monkeypatch.setattr(cores, "detect_running_core", lambda: running[0])

    assert cores.read_last_core() is None
    cores.get_cores_status()
    assert cores.read_last_core() == "mihomo"
    assert json.loads(path.read_text(encoding="utf-8")) == {"schema_version": 1, "core": "mihomo"}

    # Stopped or crashed: no process, the record stays what ran before.
    running[0] = None
    assert cores.get_cores_status() == (["xray", "mihomo"], None)
    assert cores.read_last_core() == "mihomo"


def test_the_record_is_written_only_when_the_engine_changes(monkeypatch, tmp_path):
    monkeypatch.setattr(cores, "_last_core_path", lambda: str(tmp_path / cores.LAST_CORE_FILENAME))
    writes: list[object] = []
    real_write = cores._atomic_write_json
    monkeypatch.setattr(cores, "_atomic_write_json", lambda path, obj, *a, **k: (writes.append(obj), real_write(path, obj, *a, **k)))

    for core in ("xray", "xray", "xray", "mihomo", "mihomo", None, "unknown"):
        cores.remember_running_core(core)

    assert [item["core"] for item in writes] == ["xray", "mihomo"]
    assert cores.read_last_core() == "mihomo"


def test_a_broken_record_is_no_engine(monkeypatch, tmp_path):
    path = tmp_path / cores.LAST_CORE_FILENAME
    monkeypatch.setattr(cores, "_last_core_path", lambda: str(path))

    path.write_text("{not json", encoding="utf-8")
    assert cores.read_last_core() is None
    path.write_text(json.dumps({"core": "sing-box"}), encoding="utf-8")
    assert cores.read_last_core() is None


def test_core_routes_tell_the_last_engine_and_the_status_poll_records_it(monkeypatch, tmp_path):
    from routes import service

    monkeypatch.setattr(cores, "_last_core_path", lambda: str(tmp_path / cores.LAST_CORE_FILENAME))
    monkeypatch.setattr(cores, "detect_available_cores", lambda: ["xray", "mihomo"])
    monkeypatch.setattr(cores, "detect_running_core", lambda: None)

    class Pidof:
        def __init__(self, running: str | None):
            self.running = running

        def __call__(self, cmd, **_kwargs):
            class Result:
                returncode = 0 if cmd[-1] == self.running else 1
            return Result()

    app = Flask("service-last-core")
    app.register_blueprint(service.create_service_blueprint(
        restart_xkeen=lambda **_kwargs: True,
        append_restart_log=lambda *a, **k: None,
        append_restart_log_text=lambda text: None,
        XRAY_ERROR_LOG=str(tmp_path / "xray-error.log"),
    ))
    client = app.test_client()

    assert client.get("/api/xkeen/core").get_json()["lastCore"] is None

    monkeypatch.setattr(service.subprocess, "run", Pidof("xray"))
    assert client.get("/api/xkeen/status").get_json()["core"] == "xray"

    monkeypatch.setattr(service.subprocess, "run", Pidof(None))
    assert client.get("/api/xkeen/status").get_json()["running"] is False
    body = client.get("/api/xkeen/core").get_json()
    assert (body["currentCore"], body["lastCore"]) == (None, "xray")
    assert client.get("/api/cores/status").get_json()["lastCore"] == "xray"


def test_the_last_engine_record_is_kept_by_the_installer():
    from services.module_profile_plan import user_owned
    from services.module_transactions.plan import USER_FILES

    assert user_owned(cores.LAST_CORE_FILENAME)
    assert cores.LAST_CORE_FILENAME in USER_FILES
