import { test, expect } from './fixtures.mjs';


const PROFILE = String(process.env.XKEEN_E2E_MODULE_PROFILE || 'full').toLowerCase();

const EXPECTED_SECTIONS = {
  full: ['logs', 'routing', 'mihomo'],
  'xray-minimal': ['logs', 'routing'],
  'mihomo-minimal': ['mihomo'],
  'core-only': [],
};

const HIDDEN_SECTIONS = {
  full: [],
  'xray-minimal': ['mihomo'],
  'mihomo-minimal': ['logs', 'routing'],
  'core-only': ['logs', 'routing', 'mihomo'],
};

const ACTIVE_MODULES = {
  full: ['core', 'tool.editor', 'engine.xray', 'engine.mihomo'],
  'xray-minimal': ['core', 'tool.editor', 'engine.xray'],
  'mihomo-minimal': ['core', 'tool.editor', 'engine.mihomo'],
  'core-only': ['core'],
};

const EDITOR_CAPABILITIES = {
  full: ['codemirror', 'monaco', 'diff'],
  'xray-minimal': ['codemirror'],
  'mihomo-minimal': ['codemirror'],
  'core-only': ['codemirror'],
};


test.describe(`UI settings module visibility: ${PROFILE}`, () => {
  test('shows only settings owned by active engine modules', async ({ page }) => {
    await page.route('**/api/capabilities', async (route) => {
      await route.fulfill({
        json: {
          websocket: false,
          terminal: { pty: false },
          moduleRegistry: {
            effective_module_ids: ACTIVE_MODULES[PROFILE] || ['core'],
          },
          editor: {
            variant: (EDITOR_CAPABILITIES[PROFILE] || ['codemirror']).includes('monaco') ? 'full' : 'light',
            capabilities: EDITOR_CAPABILITIES[PROFILE] || ['codemirror'],
          },
          modules: {},
        },
      });
    });
    await page.goto('/');
    const workspaceMenu = page.locator('[aria-controls="xk-mihomo-panel-menu"]');
    if (await workspaceMenu.isVisible().catch(() => false)) {
      await workspaceMenu.click();
    }
    await page.locator('#ui-settings-open-btn:visible').click();
    await expect(page.locator('#ui-settings-modal')).toBeVisible();

    for (const section of EXPECTED_SECTIONS[PROFILE] || []) {
      await expect(page.locator(`#ui-settings-nav-btn-${section}`)).toBeVisible();
      await expect(page.locator(`#ui-settings-section-${section}`)).toBeVisible();
    }
    for (const section of HIDDEN_SECTIONS[PROFILE] || []) {
      await expect(page.locator(`#ui-settings-nav-btn-${section}`)).toHaveCount(0);
      await expect(page.locator(`#ui-settings-section-${section}`)).toHaveCount(0);
    }

    const monacoScale = page.locator(
      '#ui-settings-section-editor [data-item-id="editor-monaco-font-scale"]'
    );
    const expectedMonaco = (EDITOR_CAPABILITIES[PROFILE] || []).includes('monaco') ? 1 : 0;
    await expect(monacoScale).toHaveCount(expectedMonaco);
  });
});
