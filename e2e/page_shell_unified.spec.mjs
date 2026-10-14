import { readFileSync } from 'node:fs';

import { test, expect } from './fixtures.mjs';

// DevTools, «Модули и обновления» и генератор Mihomo делят одну оболочку:
// ширину страницы и кнопки шапки (static/page-shell.css). Тест сравнивает
// живые страницы, а не текст CSS: расходиться им больше не из-за чего.
const server = JSON.parse(readFileSync(new URL('./fixtures/module_manager_server.json', import.meta.url), 'utf8'));
const PAGES = [['devtools', '/devtools'], ['modules', '/modules'], ['generator', '/mihomo_generator']];

async function mockModules(page) {
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: server.installed }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: server.status_none }));
  await page.route('**/api/modules/available', (route) => route.fulfill({ json: server.available }));
  await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({ json: server.update_check_current }));
}

async function readShell(page) {
  await expect(page.locator('header.xk-page-header .header-actions .xk-header-btn-back')).toBeVisible();
  return page.evaluate(() => {
    const pick = (el) => {
      const cs = getComputedStyle(el);
      return {
        height: Math.round(el.getBoundingClientRect().height),
        background: cs.backgroundColor,
        image: cs.backgroundImage,
        border: cs.borderTopColor,
        radius: cs.borderTopLeftRadius,
        font: `${cs.fontSize} ${cs.fontWeight}`,
        color: cs.color,
      };
    };
    const actions = document.querySelector('header.xk-page-header .header-actions');
    return {
      width: Math.round(document.querySelector('.xk-page-container').getBoundingClientRect().width),
      theme: pick(actions.querySelector('.xk-header-btn-theme')),
      themeText: actions.querySelector('.xk-header-btn-theme .theme-toggle-text').getBoundingClientRect().width > 0,
      back: pick(actions.querySelector('.xk-header-btn-back')),
      backIcon: Boolean(actions.querySelector('.xk-header-btn-back use[href$="#xk-back"]')),
      logout: pick(actions.querySelector('.xk-header-btn-logout')),
    };
  });
}

for (const theme of ['dark', 'light']) {
  test(`DevTools, modules and the Mihomo generator share one page shell in the ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.addInitScript((value) => localStorage.setItem('xkeen-theme', value), theme);
    await mockModules(page);

    const shells = {};
    for (const [name, url] of PAGES) {
      await page.goto(url);
      shells[name] = await readShell(page);
    }

    const reference = shells.devtools;
    expect(reference.back.image).toBe('none');
    expect(reference.themeText).toBe(true);
    expect(reference.backIcon).toBe(true);
    for (const [name] of PAGES) expect(shells[name], name).toEqual(reference);
  });
}

test('the Xray and Mihomo modules use the engine marks from the shared sprite', async ({ page }) => {
  await mockModules(page);
  await page.goto('/modules');
  const mihomo = page.locator('article.modules-module').filter({ hasText: 'Mihomo' }).first();
  await expect(mihomo.locator('.modules-module-icon use')).toHaveAttribute('href', /operator\.svg(?:\?[^#]*)?#xk-engine-mihomo$/);
  await expect(page.locator('.modules-module-icon img')).toHaveCount(0);

  const sprite = await (await page.request.get('/static/icons/operator.svg')).text();
  expect(sprite).toContain('<symbol id="xk-engine-xray"');
  expect(sprite).toContain('<symbol id="xk-engine-mihomo"');
});
