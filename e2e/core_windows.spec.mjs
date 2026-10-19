import { test, expect } from './fixtures.mjs';

// The service menu shows the engines as a switch; the core dialog keeps a tab
// per engine. What either shows depends on which engines are on the router
// and which engine modules the panel has.

async function serveCores(page, { cores, current = 'xray', running = true }) {
  await page.route('**/api/xkeen/status', (route) => route.fulfill({ json: { ok: true, running, core: current } }));
  await page.route('**/api/xkeen/core', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { ok: true, cores, currentCore: current } })
    : route.continue()));
  await page.route('**/api/cores/versions', (route) => route.fulfill({ json: { ok: true, cores: {
    xray: { installed: cores.includes('xray'), version: cores.includes('xray') ? '26.9.9' : null },
    mihomo: { installed: cores.includes('mihomo'), version: cores.includes('mihomo') ? 'v1.19.14' : null },
  } } }));
}

// A profile without the engine module: the page no longer lists it as active
// and renders no source controls for it.
async function dropEngineModule(page, engine) {
  await page.evaluate((name) => {
    const ids = window.XKeen.pageConfig.frontendModules.activeModuleIds;
    const at = ids.indexOf(`engine.${name}`);
    if (at >= 0) ids.splice(at, 1);
    document.querySelector(`#core-modal [data-core-source][data-core-engine="${name}"]`)?.remove();
  }, engine);
}

async function openServiceMenu(page) {
  await expect(page.locator('body')).toHaveClass(/xk-operator-header-active/);
  await page.locator('.xk-brand-service-trigger').click();
  const menu = page.locator('#xk-mihomo-service-menu');
  await expect(menu).toBeVisible();
  return menu;
}

function engineSwitch(menu, engine) {
  return menu.locator(`[data-xk-svc-core][data-core="${engine}"]`);
}

function tab(page, engine) {
  return page.locator(`#core-modal .core-option[data-core="${engine}"]`);
}

test('the service menu marks the active engine and lays the service buttons out evenly', async ({ page }) => {
  await serveCores(page, { cores: ['xray', 'mihomo'] });
  await page.goto('/');
  const menu = await openServiceMenu(page);

  await expect(menu.locator('[data-xk-svc-state-text]')).toHaveText('Работает');
  await expect(engineSwitch(menu, 'xray')).toHaveAttribute('aria-pressed', 'true');
  await expect(engineSwitch(menu, 'xray')).toContainText('26.9.9 · активно');
  await expect(engineSwitch(menu, 'xray')).toHaveAttribute('data-tooltip', 'Открыть управление ядром Xray');
  await expect(engineSwitch(menu, 'mihomo')).toHaveAttribute('aria-pressed', 'false');
  await expect(engineSwitch(menu, 'mihomo')).toContainText('1.19.14');
  await expect(menu.locator('#xkeen-core-text')).toBeHidden();

  // Two equal buttons, and the gap between them equals the menu padding.
  const [stop, restart, box] = await Promise.all([
    menu.locator('#xkeen-stop-btn').boundingBox(),
    menu.locator('#xkeen-restart-btn').boundingBox(),
    menu.boundingBox(),
  ]);
  expect(Math.abs(stop.width - restart.width)).toBeLessThanOrEqual(1);
  const gap = restart.x - (stop.x + stop.width);
  const edge = box.x + box.width - (restart.x + restart.width);
  expect(Math.abs(gap - edge)).toBeLessThanOrEqual(2);
});

test('a stopped service offers Start in the place of Stop', async ({ page }) => {
  await serveCores(page, { cores: ['xray', 'mihomo'], running: false });
  await page.goto('/');
  const menu = await openServiceMenu(page);

  await expect(menu.locator('[data-xk-svc-state-text]')).toHaveText('Остановлено');
  await expect(menu.locator('#xkeen-start-btn')).toBeVisible();
  await expect(menu.locator('#xkeen-stop-btn')).toBeHidden();
  await expect(menu.locator('#xkeen-restart-btn')).toBeVisible();
});

test('an engine with neither a binary nor a module stays out of the switch', async ({ page }) => {
  await serveCores(page, { cores: ['xray'] });
  await page.goto('/');
  await dropEngineModule(page, 'mihomo');
  const menu = await openServiceMenu(page);

  await expect(engineSwitch(menu, 'mihomo')).toBeHidden();
  await expect(menu.locator('[data-xk-svc-cores]')).toHaveAttribute('data-cores', '1');

  // The dialog still has the tab, and it leads to the modules page.
  await engineSwitch(menu, 'xray').click();
  await expect(page.locator('#core-modal')).toBeVisible();
  await tab(page, 'mihomo').click();
  await expect(tab(page, 'mihomo')).toContainText('Не установлено');
  const absent = page.locator('#core-modal [data-core-absent]');
  await expect(absent).toBeVisible();
  await expect(absent).toContainText('Mihomo не установлено на роутере');
  await expect(absent.getByRole('link', { name: 'Открыть модули' })).toBeVisible();
  await expect(page.locator('#core-modal-confirm-btn')).toBeHidden();
});

test('an absent engine with its module enabled stays listed and installable', async ({ page }) => {
  await serveCores(page, { cores: ['xray'] });
  await page.goto('/');
  const menu = await openServiceMenu(page);

  await expect(engineSwitch(menu, 'mihomo')).toBeVisible();
  await expect(engineSwitch(menu, 'mihomo')).toContainText('не установлено');
  await engineSwitch(menu, 'mihomo').click();

  await expect(page.locator('#core-modal')).toBeVisible();
  await expect(tab(page, 'mihomo')).toHaveAttribute('aria-selected', 'true');
  const source = page.locator('#core-modal [data-core-source][data-core-engine="mihomo"]');
  await expect(source).toBeVisible();
  await expect(page.locator('#core-modal [data-core-source][data-core-engine="xray"]')).toBeHidden();
  await expect(source.getByRole('button', { name: 'Выбрать источник' })).toBeVisible();
  await expect(page.locator('#core-modal-confirm-btn')).toBeHidden();
});

test('the only installed engine is shown active, and another installed one can be activated', async ({ page }) => {
  await serveCores(page, { cores: ['xray', 'mihomo'] });
  await page.goto('/');
  const menu = await openServiceMenu(page);
  await engineSwitch(menu, 'xray').click();

  await expect(tab(page, 'xray')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'xray')).toContainText('Активно');
  await expect(tab(page, 'xray')).toBeEnabled();
  await expect(tab(page, 'mihomo')).toContainText('Установлено');
  await expect(page.locator('#core-modal-confirm-btn')).toBeHidden();

  await tab(page, 'mihomo').click();
  await expect(page.locator('#core-modal-confirm-btn')).toBeVisible();
  await expect(page.locator('#core-modal-confirm-btn')).toHaveText('Сделать Mihomo активным');
  await expect(page.locator('#core-modal-status')).toContainText('Служба xkeen перезапустится');
});

test('a Mihomo-only router shows one Mihomo card', async ({ page }) => {
  await serveCores(page, { cores: ['mihomo'], current: 'mihomo' });
  await page.goto('/');
  await dropEngineModule(page, 'xray');
  const menu = await openServiceMenu(page);

  await expect(engineSwitch(menu, 'xray')).toBeHidden();
  await expect(engineSwitch(menu, 'mihomo')).toHaveAttribute('aria-pressed', 'true');
  // The card shows its state itself; the hover hint only names the action.
  // It used to keep the first aria-label, read before the engines arrived.
  await expect(engineSwitch(menu, 'mihomo')).toHaveAttribute('data-tooltip', 'Открыть управление ядром Mihomo');
  await engineSwitch(menu, 'mihomo').click();
  await expect(tab(page, 'mihomo')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'mihomo')).toContainText('Активно');
});
