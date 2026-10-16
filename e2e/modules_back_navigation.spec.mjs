import { readFileSync } from 'node:fs';

import { test, expect } from './fixtures.mjs';

// «Назад» на странице модулей ведёт туда, откуда на неё пришли: в DevTools —
// если пришли по кнопке карточки «Сборка панели», на главную — во всех
// остальных случаях. «Назад» в DevTools по-прежнему ведёт на главную, иначе
// две страницы гоняли бы друг друга по кругу.
const server = JSON.parse(readFileSync(new URL('./fixtures/module_manager_server.json', import.meta.url), 'utf8'));

async function mockModules(page) {
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: server.installed }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: server.status_none }));
  await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({ json: server.update_check_current }));
}

const back = (page) => page.locator('header .xk-header-btn-back');

test('back from the modules returns to DevTools it was opened from', async ({ page }) => {
  await mockModules(page);
  await page.goto('/devtools');
  await page.locator('#dt-update-card a[href$="/modules"]').click();
  await expect(page).toHaveURL(/\/modules$/);
  await expect(page.locator('.modules-summary')).toBeVisible();

  await back(page).click();
  await expect(page).toHaveURL(/\/devtools$/);
  await expect(page.locator('#dt-update-card')).toBeVisible();

  // DevTools itself goes back to the panel, not to the modules again.
  await expect(back(page)).toHaveAttribute('href', '/');
  await expect(back(page)).not.toHaveAttribute('data-xk-back-return', /.*/);
});

test('back from the modules opened directly goes to the panel', async ({ page }) => {
  await mockModules(page);
  await page.goto('/modules');
  await expect(page.locator('.modules-summary')).toBeVisible();
  await expect(back(page)).toHaveAttribute('href', '/');

  // A record left by a move to another page is not this page's.
  await page.evaluate(() => sessionStorage.setItem('xkeen.nav.return.v1', JSON.stringify({ from: '/devtools', to: '/devtools' })));
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
});
