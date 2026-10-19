from __future__ import annotations

from services import cores


def test_core_status_does_not_guess_xray_when_process_detection_is_inconclusive(monkeypatch):
    monkeypatch.setattr(cores, "detect_available_cores", lambda: ["xray", "mihomo"])
    monkeypatch.setattr(cores, "detect_running_core", lambda: None)

    available, current = cores.get_cores_status()

    assert available == ["xray", "mihomo"]
    assert current is None
