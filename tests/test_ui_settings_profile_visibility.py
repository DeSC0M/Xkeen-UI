from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PANEL = ROOT / "xkeen-ui" / "static" / "js" / "ui" / "settings_panel.js"


def test_ui_settings_sections_are_gated_by_the_effective_module_profile():
    text = SETTINGS_PANEL.read_text(encoding="utf-8")

    assert "requiresModules: ['engine.xray']" in text
    assert "requiresModules: ['engine.mihomo']" in text
    assert "function activeModuleIds(capabilities)" in text
    assert "moduleRegistry?.effective_module_ids" in text
    assert "requiresEditorCapabilities: ['monaco']" in text
    assert "function editorCapabilities(capabilities)" in text
    assert "function itemIsAvailable(item, ctx)" in text
    assert "ctx.editorCapabilities.has(capability)" in text
    assert "function visibleSections(" in text
    assert "visibleSections(ctx).forEach((section)" in text
    assert "loadXkeenCapabilities()" in text

