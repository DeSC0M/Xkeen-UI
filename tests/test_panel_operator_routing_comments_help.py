from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELP = ROOT / "xkeen-ui" / "static" / "routing-comments-help.html"
ROUTING = ROOT / "xkeen-ui" / "static" / "js" / "features" / "routing.js"
OPERATOR_CSS = ROOT / "xkeen-ui" / "static" / "panel-operator.css"


def test_routing_comments_help_surface_is_removed():
    routing = ROUTING.read_text(encoding="utf-8")
    css = OPERATOR_CSS.read_text(encoding="utf-8")

    assert not HELP.exists()
    assert "HELP_MODAL_ID" not in routing
    assert "openHelp" not in routing
    assert "xkeen-routing-help-modal" not in css