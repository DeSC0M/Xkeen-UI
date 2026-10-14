from __future__ import annotations

from pathlib import Path

from scripts.panel_template_source import compose_panel_template
from tests.support.template_blocks import element_markup

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "xkeen-ui/static/panel-operator.css").read_text(encoding="utf-8")
TEMPLATE = compose_panel_template(ROOT)
MODAL = element_markup(TEMPLATE, "routing-dns-over-vless-modal")


def test_modal_starts_in_a_known_layout():
    assert 'data-dns-layout="single"' in MODAL
    # Ширина берётся из существующего размера системы, а не заводится своя.
    assert "xk-modal-width-fluid-1440" in MODAL


def test_both_layouts_are_declared():
    assert '[data-dns-layout="single"] .routing-dns-over-vless-body {' in CSS
    assert '[data-dns-layout="split"] .routing-dns-over-vless-body {' in CSS


def test_narrow_screens_collapse_to_one_column():
    start = CSS.index("@media (max-width: 1100px)")
    block = CSS[start:start + 600]
    assert 'data-dns-layout="split"' in block
    assert "grid-template-areas" in block


def test_dns_over_vless_switches_keep_a_contrast_thumb():
    assert "#routing-dns-over-vless-modal .dt-switch-slider::after" in CSS
    assert "background: var(--op-text) !important;" in CSS
    assert "#routing-dns-over-vless-modal .dt-switch input:checked + .dt-switch-slider::after" in CSS
    assert "background: #fff !important;" in CSS
