import { readFileSync } from 'node:fs';

import { test, expect } from './fixtures.mjs';

// The last enabled engine stays: its tile is locked and its menu has no
// «Удалить». A refused switch is said in its own tile with the window where
// the owner fixes it; a failure with no tile is a plate above the page.
const server = JSON.parse(readFileSync(new URL('./fixtures/module_manager_server.json', import.meta.url), 'utf8'));
const mihomoOn = server.installed_mihomo_on;
const mihomo = mihomoOn.modules.find((item) => item.id === 'engine.mihomo');

// Both engines on: neither is the last one.
const bothEngines = {
  ...mihomoOn,
  installed_module_ids: [...mihomoOn.installed_module_ids, 'engine.xray'],
  modules: [
    ...mihomoOn.modules.map((item) => (item.id === 'engine.mihomo' ? { ...item, can_disable: true, lock_reason: null } : item)),
    { ...mihomo, id: 'engine.xray', module_id: 'engine.xray', name: 'Xray', can_disable: true, lock_reason: null },
  ],
};

async function mockModules(page, installed) {
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: installed }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: server.status_none }));
  await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({ json: server.update_check_current }));
}

const tile = (page, id) => page.locator(`.modules-tile[data-module-id="${id}"]`);

test('the last enabled engine is locked and cannot be removed', async ({ page }) => {
  await mockModules(page, mihomoOn);
  await page.goto('/modules');

  const engine = tile(page, 'engine.mihomo');
  await expect(engine.locator('.modules-tile-foot')).toHaveText('Единственное ядро — не выключается');
  await expect(engine.getByRole('switch')).toHaveCount(0);
  await engine.locator('.modules-tile-menu-button').click();
  await expect(engine.getByRole('button', { name: /Восстановить/ })).toBeVisible();
  await expect(engine.getByRole('button', { name: /Удалить/ })).toHaveCount(0);
});

for (const [id, name, open, label] of [
  ['engine.xray', 'Xray', 'dns-over-vless', 'Открыть DNS-over-VLESS'],
  ['engine.mihomo', 'Mihomo', 'mihomo-dns', 'Открыть защищённый DNS Mihomo'],
]) {
  test(`a refused switch of ${name} is said in its tile with the way to fix it`, async ({ page }) => {
    await mockModules(page, bothEngines);
    await page.route(`**/api/modules/${id}`, (route) => route.fulfill({
      status: 409, json: { ok: false, code: 'dns_protection_active', message: 'Сначала безопасно снимите активную DNS-защиту.' },
    }));
    await page.goto('/modules');

    await tile(page, id).getByRole('switch').locator('..').click();

    const refusal = tile(page, id).locator('.modules-tile-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal.locator('strong')).toHaveText(`${name} не выключен`);
    await expect(refusal).toContainText(`без ${name} устройства сети останутся без DNS`);
    await expect(refusal).toHaveAttribute('data-code', 'dns_protection_active');
    // The code is for the curious: in the tooltip, not in the text.
    await expect(refusal).not.toContainText('dns_protection_active');
    const link = refusal.getByRole('link', { name: label });
    await expect(link).toHaveAttribute('href', `/?open=${open}`);
    // Nothing above the page: the tile says it.
    await expect(page.locator('#modules-error')).toBeEmpty();
    // The switch shows what really is.
    await expect(tile(page, id).getByRole('switch')).toBeChecked();

    await refusal.getByRole('button', { name: 'Скрыть сообщение' }).click();
    await expect(refusal).toHaveCount(0);
  });
}

test('an engine the installer left off for its missing core says when the core appears', async ({ page }) => {
  const leftOff = (available) => ({
    ...server.installed,
    modules: server.installed.modules.map((item) => (
      item.id === 'engine.mihomo' ? { ...item, off_reason: 'core_missing', available } : item
    )),
  });
  await mockModules(page, leftOff(false));
  await page.goto('/modules');
  await expect(tile(page, 'engine.mihomo').locator('.modules-tile-foot')).toHaveText('Ядра Mihomo на роутере нет — модуль выключен');

  await mockModules(page, leftOff(true));
  await page.goto('/modules');
  await expect(tile(page, 'engine.mihomo').locator('.modules-tile-foot')).toHaveText('Ядро Mihomo найдено — модуль можно включить');
  await expect(tile(page, 'engine.mihomo').locator('.modules-tile-foot')).toHaveClass(/is-info/);
});

test('a failure with no tile is a plate above the page', async ({ page }) => {
  await mockModules(page, bothEngines);
  await page.route('**/api/modules/engine.mihomo', (route) => route.fulfill({
    status: 503, json: { ok: false, code: 'module_state_unavailable', message: 'state is busy' },
  }));
  await page.goto('/modules');

  await tile(page, 'engine.mihomo').getByRole('switch').locator('..').click();

  const plate = page.locator('#modules-error .modules-page-alert');
  await expect(plate).toBeVisible();
  await expect(plate).toHaveAttribute('data-code', 'module_state_unavailable');
  await expect(plate).not.toContainText('module_state_unavailable');
  await plate.getByRole('button', { name: 'Скрыть сообщение' }).click();
  await expect(page.locator('#modules-error')).toBeEmpty();
});

test('the panel opens the DNS-over-VLESS window asked for in the address', async ({ page }) => {
  await page.goto('/?open=dns-over-vless');
  await expect(page.locator('#routing-dns-over-vless-modal')).toBeVisible({ timeout: 20000 });
  // Asked once: a reload does not open it again.
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe('');
});
