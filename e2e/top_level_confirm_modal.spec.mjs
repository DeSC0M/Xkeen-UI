import { test, expect } from './fixtures.mjs';

// The confirm dialog keeps working after the panel switches screens in place.
//
// 14.10.2026, 45.1: in DevTools only the cross of the confirm dialog worked;
// «Отмена» and «Переустановить» did nothing, and a second dialog with
// «Отмена … Включить» showed through. Ctrl+F5 cured it. Screens are switched
// without a reload: a dialog moved to <body> on first use outlived its screen,
// the next screen brought its own dialog with the same ids, the buttons stayed
// bound to the first one, and the shared modal state (kept per id) kept opening
// the old element.

const READY = {
  path: '/opt/etc/xkeen-ui/bin/happ-decrypt-universal',
  kind: 'native',
  installed: true,
  version: 'happ-decrypt-universal v1.4.0 (8af0af5, 2026-09-15T10:00:00Z)',
  assets_dir: '/opt/etc/xkeen-ui/bin/happ-decrypt-universal.assets',
  keys: { formats: ['crypt5'], crypt5_keys: { present: true, keys: 36, invalid: 0 }, legacy_keys: null },
  keys_meta: null,
  platform: { arch: 'aarch64', opkg_arch: 'aarch64-3.10', endian: 'le', asset: 'happ-decrypt-universal-linux-arm64', supported: true },
  cmd_override: false,
};

const shownDialogs = (page) => page.locator('[id="confirm-modal"]:not(.hidden)');

// The header links sit in menus at this width; their click goes through the same screen router.
async function navigate(page, selector, url) {
  await page.locator(selector).first().dispatchEvent('click');
  await expect(page).toHaveURL(url);
}

async function reinstallAndAnswer(page, button) {
  const install = page.locator('#dt-happ-install');
  await expect(install).toHaveText('Переустановить движок');
  await install.click();
  await expect(shownDialogs(page)).toHaveCount(1);
  await expect(shownDialogs(page).locator('[id="confirm-modal-title"]')).toHaveText('Переустановить движок');
  await shownDialogs(page).locator(`[id="${button}"]`).click();
  await expect(shownDialogs(page)).toHaveCount(0);
}

test('the confirm dialog answers its own buttons on every screen it is shown', async ({ page }) => {
  const installs = [];
  await page.route('**/api/happ-decryptor/status', (route) => route.fulfill({ json: { ok: true, status: READY } }));
  await page.route('**/api/happ-decryptor/install', (route) => {
    installs.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: false, hint: 'stub' } });
  });

  await page.goto('/devtools');
  await reinstallAndAnswer(page, 'confirm-modal-cancel-btn');
  expect(installs).toEqual([]);

  // The main panel asks next, the way enabling DNS-over-VLESS does.
  await navigate(page, '.xk-header-btn-back', /\/$/);
  await page.waitForFunction(() => document.body.classList.contains('panel-page'));
  await expect(page.locator('.xk-header-btn-devtools')).toHaveAttribute('data-xk-top-nav-wired', '1');
  const answer = page.evaluate(() => window.XKeen.ui.confirm({ title: 'Включить DNS-over-VLESS?', message: 'Проверка', okText: 'Включить', cancelText: 'Отмена' }));
  await expect(shownDialogs(page)).toHaveCount(1);
  await expect(shownDialogs(page).locator('[id="confirm-modal-title"]')).toHaveText('Включить DNS-over-VLESS?');
  // Only the dialog of the panel is in the document, the one of DevTools left with its screen.
  await expect(page.locator('[id="confirm-modal"]')).toHaveCount(1);
  await shownDialogs(page).locator('[id="confirm-modal-ok-btn"]').click();
  expect(await answer).toBe(true);
  await expect(shownDialogs(page)).toHaveCount(0);

  // And back in DevTools its own dialog answers again.
  await navigate(page, '.xk-header-btn-devtools', /\/devtools/);
  await expect(page.locator('[id="confirm-modal"]')).toHaveCount(1);
  await reinstallAndAnswer(page, 'confirm-modal-cancel-btn');
  expect(installs).toEqual([]);
  await reinstallAndAnswer(page, 'confirm-modal-ok-btn');
  await expect.poll(() => installs.length).toBe(1);
});
