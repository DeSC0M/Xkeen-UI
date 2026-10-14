import { test, expect, selectPanelView } from './fixtures.mjs';


const PROFILE = String(process.env.XKEEN_E2E_MODULE_PROFILE || 'full').toLowerCase();
const ENGINE = PROFILE === 'xray-minimal' ? 'xray' : 'mihomo';
const VIEW = ENGINE === 'xray' ? 'routing' : 'mihomo';


function profiles() {
  const label = ENGINE === 'xray' ? 'Xray' : 'Mihomo';
  return {
    ok: true,
    data: {
      engine_id: ENGINE,
      platform: { machine: 'aarch64', opkg_arch: 'aarch64-3.10' },
      state: {
        selected_profile_id: 'official',
        installed_profile_id: 'official',
        last_status: 'idle',
      },
      profiles: [
        {
          profile_id: 'official',
          display_name: `Официальный ${label}`,
          repo: 'example/official',
          description: 'Базовая совместимость.',
          release: {
            installable: true,
            stable: { tag: 'v1' },
            asset: { name: 'core.gz' },
            checksum: { sha256: 'a'.repeat(64) },
          },
        },
        {
          profile_id: 'fork',
          display_name: `${label} Fork`,
          repo: 'example/fork',
          description: 'Альтернативная сборка.',
          release: {
            installable: true,
            stable: { tag: 'v1-fork' },
            asset: { name: 'fork.gz' },
            checksum: { sha256: 'b'.repeat(64) },
          },
        },
      ],
    },
  };
}


test.describe(`single-engine core source selection: ${PROFILE}`, () => {
  test('keeps fork selection reachable when only one engine is installed', async ({ page }) => {
    await page.route(`**/api/${ENGINE}/core-profiles`, async (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(profiles()),
    }));

    await page.goto('/');
    await selectPanelView(page, VIEW);
    await page.locator('.xk-brand-service-trigger').click();
    await expect(page.locator('#xk-mihomo-service-menu')).toBeVisible();
    await page.locator('#xkeen-core-text').click();

    const card = page.locator(`[data-core-source][data-core-engine="${ENGINE}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Источник' }).click();

    const modal = page.locator(`#${ENGINE}-core-source-modal`);
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('radio', { name: /Fork/ })).toBeVisible();
  });
});
