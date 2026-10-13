import { test, expect } from './fixtures.mjs';

const installed = {
  ok: true,
  panel_version: '2.10.0',
  build: {
    exists: true, version: '2.10.0', commit: 'abc123456789abcdef0123456789abcdef012345',
    built_utc: '2026-10-09T09:10:11Z', repo: 'umarcheh001/Xkeen-UI', channel: 'stable',
  },
  profile: 'custom',
  installed_set: 'full',
  enabled_set: 'custom',
  lifecycle: { available: true, code: null },
  modules: [
    { id: 'core', name: 'Xkeen UI Core', version: '1.0.0', enabled: true, status: 'enabled' },
    { id: 'engine.mihomo', name: 'Mihomo', version: '1.19.0', enabled: false, status: 'disabled' },
    { id: 'tool.terminal', name: 'Терминал и команды', version: '1.0.0', enabled: true, status: 'failed' },
  ],
};

const noUpdate = {
  ok: true, source_version: '2.10.0', target_version: '2.10.0', update_available: false,
  requires_installer: false, min_updater: null, freshness: 'fresh', stale_reason: null, fetched_at: 1791700000,
};

async function mockPanelSummary(page, { snapshot = installed, check = noUpdate } = {}) {
  const checks = [];
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/modules/panel/update-check', (route) => {
    checks.push(route.request().postDataJSON());
    return route.fulfill({ json: check });
  });
  return checks;
}

test.describe('DevTools panel summary', () => {
  test('persists the selected prerelease channel and refreshes the update note', async ({ page }) => {
    let selected = 'stable';
    const changes = [];
    await page.route('**/api/modules/installed', (route) => route.fulfill({
      json: { ...installed, update_channel: selected },
    }));
    await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({
      json: { ...noUpdate, target_version: selected === 'prerelease' ? '2.11.0-rc.1' : '2.10.0', update_available: selected === 'prerelease' },
    }));
    await page.route('**/api/modules/update-channel', (route) => {
      if (route.request().method() === 'POST') {
        selected = route.request().postDataJSON().channel;
        changes.push(selected);
      }
      return route.fulfill({ json: { ok: true, channel: selected } });
    });
    await page.goto('/devtools');
    await expect(page.locator('#dt-panel-version')).toHaveText('2.10.0');
    await page.locator('#dt-panel-channel').click();
    await expect(page.locator('#dt-panel-channel-options')).toBeVisible();
    await page.locator('#dt-panel-channel-options [data-channel="prerelease"]').click();
    await expect(page.locator('#dt-panel-channel')).toHaveText('Предрелиз');
    await expect(page.locator('#dt-panel-update-note')).toContainText('2.11.0-rc.1');
    await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: { ok: true, result: null } }));
    await page.goto('/modules');
    await expect(page.getByText('Источник: umarcheh001/Xkeen-UI · канал сборки: stable')).toBeVisible();
    await expect(page.getByText('Канал обновлений: Предрелиз')).toBeVisible();
    expect(changes).toEqual(['prerelease']);
  });

  test('lists every module on its own row with version and state', async ({ page }) => {
    const checks = await mockPanelSummary(page);
    await page.goto('/devtools');

    const card = page.locator('#dt-update-card');
    await expect(card.locator('h2')).toHaveText('Сборка панели');
    await expect(page.locator('#dt-panel-version')).toHaveText('2.10.0');
    // Полный хэш рвал строку надвое: печатается короткий.
    await expect(page.locator('#dt-panel-commit')).toHaveText('(abc123456789)');
    await expect(page.locator('#dt-panel-repo')).toHaveText('umarcheh001/Xkeen-UI');
    await expect(card.locator('dt')).toContainText(['Версия', 'Собрана', 'Источник', 'Канал обновлений', 'Установлено', 'Включено']);
    await expect(page.locator('#dt-panel-channel')).toHaveText('Стабильный');
    // Сохранённая метка профиля не печатается: наборы названы по составу.
    await expect(page.locator('#dt-panel-installed-set')).toHaveText('полный набор');
    await expect(page.locator('#dt-panel-enabled-set')).toHaveText('свой набор (2 из 3)');
    await expect(card).not.toContainText('custom');

    const rows = page.locator('#dt-panel-modules .dt-panel-module');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'ok');
    await expect(rows.nth(0).locator('.dt-panel-module-name')).toHaveText('Xkeen UI Core');
    await expect(rows.nth(0).locator('.dt-panel-module-version')).toHaveText('1.0.0');
    await expect(rows.nth(0).locator('.dt-panel-module-state')).toHaveText('включён');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'off');
    await expect(rows.nth(1).locator('.dt-panel-module-state')).toHaveText('выключен');
    await expect(rows.nth(2)).toHaveAttribute('data-state', 'bad');
    await expect(rows.nth(2).locator('.dt-panel-module-state')).toHaveText('ошибка');

    // Строки стоят друг под другом, а не в одну линию.
    const tops = await rows.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(3);

    const note = page.locator('#dt-panel-update-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Обновлений нет.');
    await expect(note).toHaveAttribute('data-tone', 'ok');
    // Открытие вкладки берёт ответ из сохранённого каталога и на GitHub не ходит.
    expect(checks).toEqual([{ force_refresh: false }]);

    // Карточка справочная: команд обновления в ней нет, плашка ошибки спрятана.
    await expect(card.locator('#dt-panel-channel')).toHaveCount(1);
    await expect(card.locator('[data-channel]')).toHaveCount(2);
    await expect(card.locator('[data-channel="stable"]')).toHaveText('Стабильный канал');
    await expect(card.locator('[data-channel="prerelease"]')).toHaveText('Предрелизный канал');
    const channelGeometry = await card.locator('.dt-panel-channel-cell').evaluate((cell) => {
      const trigger = cell.querySelector('.dt-panel-channel-trigger');
      const repo = document.querySelector('#dt-panel-repo');
      if (!trigger || !repo) return null;
      const triggerStyle = getComputedStyle(trigger);
      const repoStyle = getComputedStyle(repo);
      return {
        channelCellPaddingTop: Number.parseFloat(getComputedStyle(cell).paddingTop),
        triggerHeight: trigger.getBoundingClientRect().height,
        repoHeight: repo.getBoundingClientRect().height,
        triggerMinHeight: triggerStyle.minHeight,
        repoMinHeight: repoStyle.minHeight,
      };
    });
    expect(channelGeometry).not.toBeNull();
    expect(channelGeometry.channelCellPaddingTop).toBeGreaterThanOrEqual(4);
    expect(channelGeometry.triggerHeight).toBeLessThanOrEqual(channelGeometry.repoHeight + 2);
    expect(channelGeometry.triggerMinHeight).toBe('22px');
    await expect(page.locator('#dt-panel-status')).toBeHidden();
    await expect(page.locator('#xk-update-link')).toHaveCount(0);
  });

  test('announces a new panel version above the module list', async ({ page }) => {
    await mockPanelSummary(page, {
      check: { ...noUpdate, target_version: '2.10.1', update_available: true },
    });
    await page.goto('/devtools');

    const note = page.locator('#dt-panel-update-note');
    await expect(note).toContainText('Доступна версия 2.10.1.');
    await expect(note).toContainText('Модули и обновления');
    await expect(note).toHaveAttribute('data-tone', 'warn');
  });

  test('a local build does not ask the catalog and shows no update line', async ({ page }) => {
    const checks = await mockPanelSummary(page, {
      snapshot: { ...installed, panel_version: null, lifecycle: { available: false, code: 'panel_version_unsupported' } },
    });
    await page.goto('/devtools');

    await expect(page.locator('#dt-panel-modules .dt-panel-module')).toHaveCount(3);
    await expect(page.locator('#dt-panel-update-note')).toBeHidden();
    expect(checks).toEqual([]);
  });

  test('shows the error only when the summary cannot be loaded and recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/api/modules/installed', (route) => route.fulfill(
      fail ? { status: 503, json: { ok: false, code: 'module_state_unavailable', message: 'временный сбой' } } : { json: installed },
    ));
    await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({ json: noUpdate }));
    await page.goto('/devtools');

    const status = page.locator('#dt-panel-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Не удалось загрузить сведения о панели');
    await expect(page.locator('#dt-panel-version')).toHaveText('—');

    fail = false;
    await page.evaluate(async () => {
      const { getDevtoolsNamespace } = await import('/static/js/features/devtools_namespace.js');
      getDevtoolsNamespace().devtoolsUpdate.activate();
    });
    await expect(page.locator('#dt-panel-version')).toHaveText('2.10.0');
    await expect(status).toBeHidden();
  });
});
