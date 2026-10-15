import { readFileSync } from 'node:fs';

import { test, expect } from './fixtures.mjs';


const PROFILE = String(process.env.XKEEN_E2E_MODULE_PROFILE || 'full').toLowerCase();
const server = JSON.parse(readFileSync(new URL('./fixtures/module_manager_server.json', import.meta.url), 'utf8'));


test(`Modules screen owns the update channel only without DevTools: ${PROFILE}`, async ({ page }) => {
  let selected = 'stable';
  await page.route('**/api/modules/installed', (route) => route.fulfill({
    json: { ...server.installed, update_channel: selected },
  }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: server.status_none }));
  await page.route('**/api/modules/update-channel', (route) => {
    if (route.request().method() === 'POST') selected = route.request().postDataJSON().channel;
    return route.fulfill({ json: { ok: true, channel: selected } });
  });

  await page.goto('/modules');

  const channel = page.locator('.modules-update-channel');
  const expected = PROFILE === 'full' ? 0 : 1;
  await expect(channel).toHaveCount(expected);

  if (expected === 1) {
    await expect(page.locator('body')).toHaveAttribute('data-xk-devtools-available', '0');
    const prerelease = channel.locator('button[data-channel="prerelease"]');
    await prerelease.click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-modal-ok-btn').click();
    await expect(prerelease).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toBe('prerelease');
  } else {
    await expect(page.locator('body')).toHaveAttribute('data-xk-devtools-available', '1');
  }
});

test('local builds still allow changing the selected update channel', async ({ page }) => {
  let selected = 'stable';
  let changes = 0;
  await page.route('**/api/modules/installed', (route) => route.fulfill({
    json: {
      ...server.installed,
      update_channel: selected,
      panel_version: null,
      lifecycle: { available: false, code: 'panel_version_unsupported' },
    },
  }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: server.status_none }));
  await page.route('**/api/modules/update-channel', (route) => {
    if (route.request().method() === 'POST') {
      selected = route.request().postDataJSON().channel;
      changes += 1;
    }
    return route.fulfill({ json: { ok: true, channel: selected } });
  });

  await page.goto('/modules');
  const channel = page.locator('.modules-update-channel');
  await expect(channel.locator('button[data-channel="stable"]')).toBeEnabled();
  await channel.locator('button[data-channel="prerelease"]').click();
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-modal-ok-btn').click();
  await expect(channel.locator('button[data-channel="prerelease"]')).toHaveAttribute('aria-pressed', 'true');
  expect(changes).toBe(1);
  expect(selected).toBe('prerelease');
});
