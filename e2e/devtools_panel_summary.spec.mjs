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

const summary = '#dt-panel-summary';
const stat = (page, name) => page.locator(`${summary} .xk-summary-stat[data-stat="${name}"]`);
const channelButton = (page, name) => page.locator(`${summary} .xk-summary-switch [data-channel="${name}"]`);

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
  test('persists the selected prerelease channel and refreshes the update counter', async ({ page }) => {
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
    await expect(page.locator(`${summary} .xk-summary-version`)).toHaveText('Xkeen UI 2.10.0');
    const stable = channelButton(page, 'stable');
    const prerelease = channelButton(page, 'prerelease');
    await expect(stable).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${summary} .xk-summary-channel-hint`)).toHaveText('Проверенные версии. Выбирайте, если панель просто должна работать.');

    // Тестовые версии — риск: переход спрашивают, отказ ничего не меняет.
    await prerelease.click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-modal-title')).toHaveText('Перейти на предрелизный канал?');
    await expect(page.locator('#confirm-modal-message')).toContainText('возможны ошибки');
    await page.locator('#confirm-modal-cancel-btn').click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(stable).toHaveAttribute('aria-pressed', 'true');
    expect(changes).toEqual([]);

    await prerelease.click();
    await page.locator('#confirm-modal-ok-btn').click();
    await expect(channelButton(page, 'prerelease')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${summary} .xk-summary-channel-hint`)).toHaveText('Тестовые версии с новыми функциями. Выбирайте, если готовы находить ошибки и сообщать о них.');
    await expect(page.locator(`${summary} .xk-summary-chip`)).toHaveText('Предрелизный канал');
    await expect(stat(page, 'update').locator('b')).toHaveText('2.11.0 rc.1');
    await expect(page.locator(`${summary} .xk-summary-link`)).toHaveText('Обновить в «Модулях и обновлениях»');

    // Шапка «Модулей и обновлений» — та же сводка.
    await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: { ok: true, result: null } }));
    await page.goto('/modules');
    await expect(page.locator('.modules-summary .xk-summary-meta-line')).toContainText('Источник: umarcheh001/Xkeen-UI');
    await expect(page.locator('.modules-summary .xk-summary-chip')).toHaveText('Предрелизный канал');
    expect(changes).toEqual(['prerelease']);
  });

  test('going back to the stable channel needs no confirmation', async ({ page }) => {
    let selected = 'prerelease';
    const changes = [];
    await page.route('**/api/modules/installed', (route) => route.fulfill({
      json: { ...installed, panel_version: '2.11.0-rc.1', build: { ...installed.build, version: '2.11.0-rc.1' }, update_channel: selected },
    }));
    await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({
      json: { ...noUpdate, source_version: '2.11.0-rc.1', target_version: '2.11.0-rc.1' },
    }));
    await page.route('**/api/modules/update-channel', (route) => {
      if (route.request().method() === 'POST') {
        selected = route.request().postDataJSON().channel;
        changes.push(selected);
      }
      return route.fulfill({ json: { ok: true, channel: selected } });
    });
    await page.goto('/devtools');
    // Установлена тестовая версия — это видно по самой версии.
    await expect(page.locator(`${summary} .xk-summary-version`)).toHaveText('Xkeen UI 2.11.0-rc.1');
    await expect(channelButton(page, 'prerelease')).toHaveAttribute('aria-pressed', 'true');

    await channelButton(page, 'stable').click();

    await expect(channelButton(page, 'stable')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    expect(changes).toEqual(['stable']);
  });

  test('counts modules and lists only those that need attention', async ({ page }) => {
    const checks = await mockPanelSummary(page);
    await page.goto('/devtools');

    const card = page.locator('#dt-update-card');
    await expect(card.locator('h2')).toHaveText('Сборка панели');
    await expect(page.locator(`${summary} .xk-summary-version`)).toHaveText('Xkeen UI 2.10.0');
    await expect(page.locator(`${summary} .xk-summary-chip`)).toHaveText('Стабильный канал');
    await expect(page.locator(`${summary} .xk-summary-meta-line`)).toContainText('Источник: umarcheh001/Xkeen-UI · собрано 09.10.2026');
    // Сохранённая метка профиля не печатается.
    await expect(card).not.toContainText('custom');

    // Полный хэш рвал строку: в подробностях о сборке он короткий.
    const more = page.locator(`${summary} .xk-summary-more`);
    await more.locator('summary').click();
    await expect(more.locator('dd').filter({ hasText: 'abc123456789' })).toHaveText('abc123456789');

    await expect(stat(page, 'enabled').locator('b')).toHaveText('2 из 3');
    await expect(stat(page, 'attention').locator('b')).toHaveText('1');
    await expect(stat(page, 'attention').locator('span')).toHaveText('требует внимания');
    await expect(stat(page, 'update').locator('b')).toHaveText('2.10.0');
    await expect(stat(page, 'update').locator('span')).toHaveText('версия актуальна');

    // Полного списка модулей нет — только тот, что не запустился.
    const issues = page.locator(`${summary} .xk-summary-issues li`);
    await expect(issues).toHaveCount(1);
    await expect(issues.first()).toHaveAttribute('data-module-id', 'tool.terminal');
    await expect(issues.first()).toContainText('Не запустился при последнем старте панели');

    // Открытие вкладки берёт ответ из сохранённого каталога и на GitHub не ходит.
    expect(checks).toEqual([{ force_refresh: false }]);

    // Карточка справочная: команд обновления в ней нет, только переход в «Модули и обновления».
    await expect(card.locator('button.modules-update-check-button')).toHaveCount(0);
    const link = page.locator(`${summary} .xk-summary-link`);
    await expect(link).toHaveText('Открыть «Модули и обновления»');
    await expect(link).toHaveAttribute('href', /\/modules$/);
    await expect(channelButton(page, 'stable')).toHaveText('Стабильный');
    await expect(channelButton(page, 'prerelease')).toHaveText('Предрелизный');

    // Переключатель тянется до правого края плашек, пилюля канала — по центру заголовка.
    const geometry = await page.locator(summary).evaluate((root) => {
      const box = (selector) => root.querySelector(selector).getBoundingClientRect();
      const mid = (r) => r.top + r.height / 2;
      return {
        switchRight: box('.xk-summary-switch').right,
        statsRight: box('.xk-summary-stats').right,
        chip: mid(box('.xk-summary-chip')),
        version: mid(box('.xk-summary-version')),
      };
    });
    expect(Math.abs(geometry.switchRight - geometry.statsRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chip - geometry.version)).toBeLessThanOrEqual(1.5);
    await expect(page.locator('#dt-panel-status')).toBeHidden();
    await expect(page.locator('#xk-update-link')).toHaveCount(0);
  });

  test('a new panel version turns the link into the update action', async ({ page }) => {
    await mockPanelSummary(page, {
      check: { ...noUpdate, target_version: '2.10.1', update_available: true },
    });
    await page.goto('/devtools');

    await expect(stat(page, 'update').locator('b')).toHaveText('2.10.1');
    await expect(stat(page, 'update').locator('span')).toHaveText('доступно обновление');
    await expect(stat(page, 'update')).toHaveClass(/is-accent/);
    await expect(page.locator(`${summary} .xk-summary-link`)).toHaveClass(/is-primary/);
    await expect(page.locator(`${summary} .xk-summary-link`)).toHaveText('Обновить в «Модулях и обновлениях»');
  });

  test('says the core is missing instead of calling an installed module unavailable', async ({ page }) => {
    await mockPanelSummary(page, {
      snapshot: {
        ...installed,
        modules: [
          {
            id: 'engine.mihomo', name: 'Mihomo', version: '1.0.0', enabled: true, status: 'unavailable',
            reason: 'system_requirements_unmet', missing_requirement_ids: ['mihomo'], unavailable_dependency_ids: [],
          },
          {
            id: 'tool.terminal', name: 'Терминал и команды', version: '1.0.0', enabled: true, status: 'unavailable',
            reason: 'dependency_unavailable', missing_requirement_ids: [], unavailable_dependency_ids: ['core'],
          },
        ],
      },
    });
    await page.goto('/devtools');

    const issues = page.locator(`${summary} .xk-summary-issues li`);
    await expect(issues).toHaveCount(2);
    await expect(issues.nth(0)).toContainText('Mihomo');
    await expect(issues.nth(0)).toContainText('Ядро Mihomo на роутере не найдено');
    await expect(issues.nth(1)).toContainText('Не работает без модуля: core');
    await expect(stat(page, 'attention').locator('b')).toHaveText('2');
    await expect(stat(page, 'attention').locator('span')).toHaveText('требуют внимания');
  });

  test('a local build does not ask the catalog and says why updates are off', async ({ page }) => {
    const checks = await mockPanelSummary(page, {
      snapshot: { ...installed, panel_version: null, lifecycle: { available: false, code: 'panel_version_unsupported' } },
    });
    await page.goto('/devtools');

    await expect(page.locator(`${summary} .xk-summary-version`)).toHaveText('Локальная сборка 2.10.0');
    await expect(stat(page, 'update').locator('span')).toHaveText('обновление из окна недоступно');
    await expect(page.locator(`${summary} .xk-summary-note`)).toContainText('Локальная сборка.');
    await expect(page.locator(`${summary} .xk-summary-channel-hint`)).toHaveText('Канал запомнится и сработает, когда панель будет поставлена из выпуска.');
    expect(checks).toEqual([]);
  });

  test('a local build of a release offers the next release but keeps modules as they are', async ({ page }) => {
    const local = '2.10.0-beta.2+local.f46f1f10.dirty';
    const checks = await mockPanelSummary(page, {
      snapshot: {
        ...installed,
        panel_version: local,
        build: { ...installed.build, version: local },
        lifecycle: { available: true, code: null, local: true },
      },
      check: { ...noUpdate, source_version: local, target_version: '2.10.0-beta.3', update_available: true },
    });
    await page.goto('/devtools');

    await expect(page.locator(`${summary} .xk-summary-version`)).toHaveText('Локальная сборка 2.10.0-beta.2');
    await expect(stat(page, 'update').locator('b')).toHaveText('2.10.0 beta.3');
    await expect(stat(page, 'update').locator('span')).toHaveText('доступно обновление');
    await expect(page.locator(`${summary} .xk-summary-note`)).toContainText('ставить и удалять модули — только на выпуске');
    expect(checks.length).toBe(1);
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
    await expect(page.locator(summary)).toHaveText('—');

    fail = false;
    await page.evaluate(async () => {
      const { getDevtoolsNamespace } = await import('/static/js/features/devtools_namespace.js');
      getDevtoolsNamespace().devtoolsUpdate.activate();
    });
    await expect(page.locator(`${summary} .xk-summary-version`)).toHaveText('Xkeen UI 2.10.0');
    await expect(status).toBeHidden();
  });
});
