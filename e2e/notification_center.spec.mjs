import { readFileSync } from 'node:fs';

import { test, expect } from './fixtures.mjs';

const server = JSON.parse(readFileSync(new URL('./fixtures/module_manager_server.json', import.meta.url), 'utf8'));

function record(id, kind, title, message) {
  return {
    id,
    kind,
    channel: 'prerelease',
    version: '2.11.0-beta.1',
    title,
    message,
    size: 1_048_576,
    requires_restart: true,
    dependency_changes: { requires_added: ['tool.editor'], requires_removed: [], conflicts_added: [], conflicts_removed: [] },
    seen: false,
  };
}

async function mockLifecycle(page) {
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: server.installed }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: server.status_none }));
  await page.route('**/api/modules/panel/update-check', (route) => route.fulfill({ json: server.update_check_current }));
}

test('notification center is core-owned, text-safe, and does not fetch archives', async ({ page }) => {
  await mockLifecycle(page);
  let records = [
    record('a'.repeat(64), 'panel-update', 'Доступна новая версия панели', 'Сохранит выбранный профиль.'),
    record('b'.repeat(64), 'module-new', '<img src=x onerror=alert(1)>', 'Новый модуль появится после обновления панели.'),
  ];
  const snapshot = () => ({
    ok: true,
    channel: 'prerelease',
    records,
    unread_count: records.filter((item) => !item.seen).length,
    status: { last_success_at: 1_791_700_000, freshness: 'fresh', stale_reason: null, error_code: null },
  });
  const archiveRequests = [];
  page.on('request', (request) => {
    if (/\.tar\.gz(?:$|[?#])/.test(request.url())) archiveRequests.push(request.url());
  });
  await page.route('**/api/notifications', (route) => route.fulfill({ json: snapshot() }));
  await page.route('**/api/notifications/mark-seen', async (route) => {
    const body = route.request().postDataJSON();
    const seen = new Set(body.record_ids);
    records = records.map((item) => (seen.has(item.id) ? { ...item, seen: true } : item));
    await route.fulfill({ json: snapshot() });
  });
  await page.route('**/api/notifications/check', (route) => route.fulfill({ json: snapshot() }));
  await page.route('**/api/notifications/*', async (route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON();
    if (url.endsWith('/mark-seen')) {
      const seen = new Set(body.record_ids || []);
      records = records.map((item) => (seen.has(item.id) ? { ...item, seen: true } : item));
    } else if (body.action === 'dismiss') {
      records = records.filter((item) => !url.endsWith(item.id));
    }
    await route.fulfill({ json: snapshot() });
  });

  await page.goto('/modules');
  const trigger = page.locator('.xk-notification-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('.xk-notification-trigger__count')).toHaveText('2');

  await trigger.click();
  const center = page.locator('.xk-notification-popover');
  await expect(center).toBeVisible();
  await expect(center).toContainText('Доступна новая версия панели');
  await expect(center).toContainText('Новый модуль появится после обновления панели.');
  await expect(center.locator('img')).toHaveCount(0);
  await expect(center).toContainText('<img src=x onerror=alert(1)>');

  await center.getByRole('button', { name: 'Проверить обновления' }).click();
  await expect(center).toContainText('Проверено');
  await expect(archiveRequests).toEqual([]);

  await center.locator('.xk-notification-record').first().getByRole('button', { name: 'Скрыть' }).click();
  await expect(trigger.locator('.xk-notification-trigger__count')).toHaveText('0');
});
