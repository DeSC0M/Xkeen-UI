from pathlib import Path

from flask import Flask, Response

from routes.ui_assets import apply_response_security_headers


def test_app_factory_applies_global_security_headers_after_cache_policy():
    app_factory = Path("xkeen-ui/app_factory.py").read_text(encoding="utf-8")

    assert "from routes.ui_assets import (" in app_factory
    assert "apply_response_cache_policy," in app_factory
    assert "apply_response_security_headers," in app_factory
    assert "compress_response_if_worthwhile," in app_factory

    # Важен порядок, а не дословное написание: политика кэша, поверх неё
    # security-заголовки, и только потом сжатие — оно меняет тело, и всё, что
    # правит заголовки, обязано отработать раньше.
    steps = [
        "apply_response_cache_policy(response)",
        "apply_response_security_headers(response)",
        "compress_response_if_worthwhile(response)",
    ]
    positions = [app_factory.find(step) for step in steps]
    assert all(pos > 0 for pos in positions), positions
    assert positions == sorted(positions), positions


def test_ui_assets_exposes_conservative_baseline_security_headers():
    text = Path("xkeen-ui/routes/ui_assets.py").read_text(encoding="utf-8")

    assert '_BASELINE_SECURITY_HEADERS = {' in text
    assert '"X-Frame-Options": "DENY"' in text
    assert '"Referrer-Policy": "no-referrer"' in text
    assert '"Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()"' in text
    assert '"X-Content-Type-Options": "nosniff"' in text
    assert 'def apply_response_security_headers(resp: Response) -> Response:' in text
    assert 'resp.headers.setdefault(key, value)' in text


def test_regular_static_assets_keep_deny_framing_baseline():
    app = Flask(__name__)

    with app.test_request_context("/static/js/features/routing.js"):
        resp = apply_response_security_headers(Response(""))

    assert resp.headers["X-Frame-Options"] == "DENY"
