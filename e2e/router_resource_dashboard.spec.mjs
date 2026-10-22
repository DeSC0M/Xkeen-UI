import fs from 'node:fs/promises';
import { test, expect } from './fixtures.mjs';

function resources(at = Date.now() / 1000, percent = 12.4) {
  return {
    ok: true, sampled_at: at,
    cpu: { percent, cores: 4, load_1m: 0.65, load_5m: 0.42, load_15m: 0.31, total_tasks: 123, runnable_tasks: 2 },
    memory: { percent: 56.2, total_bytes: 1024 ** 3, used_bytes: 603442905, swap_total_bytes: 0, swap_used_bytes: 0 },
    storage: { percent: 18.5, total_bytes: 8 * 1024 ** 3, free_bytes: 7 * 1024 ** 3 },
    temperature_celsius: 63.5, uptime_seconds: 86420,
    network: { receive_bytes_per_second: 1350000, send_bytes_per_second: 280000, received_bytes: 123000000, sent_bytes: 5000000, interfaces: [{ name: 'eth0' }] },
    router: {
      freshness: { state: 'fresh', age_seconds: 0 },
      rci: { available: true },
      internet: { available: true, internet: true, gateway: true, dns: true, captive: true, interface: 'GigabitEthernet1', address: '192.0.2.1' },
      conntrack: { available: true, percent: 3.2, count: 1048, max: 32768, available_entries: 31720 },
      interfaces: { available: true, items: [] },
      incidents: [],
    },
  };
}

async function openDashboard(page) {
  await page.goto('/');
  const monitor = page.locator('#xk-resource-monitor');
  await expect(monitor).toHaveAttribute('data-state', 'ready');
  // The compact shell can move this trigger into its overflow on phones.
  await monitor.evaluate(button => button.click());
  await expect(page.locator('#xk-resource-dashboard-modal')).toBeVisible();
}

for (const width of [1600, 1024, 390]) {
  test(`resource dashboard renders real metrics and controls at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    const heavy = [];
    let calls = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/api\/system\/(processes|router\/(clients|lte|channel-check|dns-diagnostics))/.test(request.url())) heavy.push(request.url());
    });
    await page.route('**/api/system/resources', route => route.fulfill({ json: resources(1792602000 + ++calls * 5) }));
    await openDashboard(page);
    await expect(page.locator('#xk-resource-dashboard-cpu')).toHaveText('12.4%');
    await expect(page.locator('#xk-resource-load-1')).toHaveText('0.65');
    await expect(page.locator('#xk-resource-load-explanation')).toContainText('при 4 ядрах');
    await expect(page.locator('.xk-history-guide')).toContainText('реакция сейчас');
    if (width >= 1200) {
      const overview = await page.locator('.xk-resource-overview').boundingBox();
      expect(overview.height).toBeLessThan(160);
    }
    await expect(page.locator('#xk-resource-dashboard-swap')).toHaveText('Нет');
    expect(await page.locator('.xk-dashboard-gauge .xk-resource-stat-meter').first().evaluate(element => getComputedStyle(element, '::after').maskImage)).toContain('data:image/svg+xml');
    await expect(page.locator('#xk-resource-health-title')).toHaveText('Система в норме');
    const api = () => page.evaluate(async () => {
      const { resourceMonitorApi } = await import('/static/js/features/resource_monitor.js');
      await resourceMonitorApi.refresh();
    });
    await api();
    await page.locator('#xk-resource-poll').selectOption('0');
    await expect(page.locator('#xk-resource-live')).toHaveText('На паузе');

    const networkToggle = page.locator('[data-chart-toggle="network"][data-series="receive"]');
    await networkToggle.click();
    await expect(networkToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#xk-resource-chart-network-stats .is-disabled')).toContainText('Приём');
    await networkToggle.click();
    await expect(networkToggle).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#xk-dashboard-overview > summary').click();
    await expect(page.locator('#xk-resource-dashboard-cpu')).toBeHidden();
    await page.locator('#xk-dashboard-overview > summary').click();
    await expect(page.locator('#xk-resource-dashboard-cpu')).toBeVisible();
    await page.locator('#xk-resource-chart-load').scrollIntoViewIfNeeded();
    await expect(page.locator('#xk-resource-chart-load-stats')).toContainText('сред');
    await expect(page.locator('#xk-resource-chart-load-stats')).toContainText('0.65');
    await page.locator('#xk-dashboard-history > summary').click();
    await expect(page.locator('#xk-resource-chart-cpu')).toBeHidden();
    await page.locator('#xk-dashboard-history > summary').click();
    await expect.poll(() => page.locator('#xk-resource-chart-cpu').evaluate(canvas => canvas.width)).toBeGreaterThan(0);
    expect(heavy).toEqual([]);
    expect(errors).toEqual([]);

    const bounds = await page.locator('#xk-resource-dashboard-modal .modal-content').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const body = element.querySelector('.modal-body');
      const header = element.querySelector('.modal-header');
      return { left: rect.left, right: rect.right, width: innerWidth, overflow: body.scrollWidth - body.clientWidth, bodyTop: body.getBoundingClientRect().top, headerBottom: header.getBoundingClientRect().bottom };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    expect(bounds.bodyTop).toBeGreaterThanOrEqual(bounds.headerBottom);
    await page.locator('.xk-resource-dashboard-body').evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.dispatchEvent(new Event('resize')); });
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`) });
    // Both themes use the host panel tokens.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.dispatchEvent(new Event('resize')); });
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}-light.png`) });
    await page.keyboard.press('Escape');
    await expect(page.locator('#xk-resource-dashboard-modal')).toBeHidden();
  });
}

test('pause prevents automatic requests, manual refresh recovers stale data and snapshot is private', async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  let fail = false;
  await page.route('**/api/system/resources', route => {
    calls++;
    return route.fulfill(fail ? { status: 503, json: { ok: false } } : { json: resources(1792602000 + calls * 30) });
  });
  await page.route('**/api/system/router/dns-diagnostics', route => route.fulfill({ json: { ok: true, state: 'ok' } }));
  await openDashboard(page);
  await page.locator('#xk-resource-poll').selectOption('0');
  const pausedCalls = calls;
  await page.clock.fastForward(35000);
  expect(calls).toBe(pausedCalls);
  await page.locator('#xk-resource-poll').selectOption('15000');
  await page.clock.fastForward(15100);
  await expect.poll(() => calls).toBe(pausedCalls + 1);
  await page.locator('#xk-resource-poll').selectOption('0');
  fail = true;
  await page.locator('#xk-resource-dashboard-refresh').click();
  await expect(page.locator('#xk-resource-health-title')).toHaveText('Телеметрия недоступна');
  await expect(page.locator('#xk-resource-dashboard-cpu')).toHaveText('12.4%');
  await expect(page.locator('.xk-resource-dashboard-body')).toHaveAttribute('data-freshness', 'stale');
  fail = false;
  await page.locator('#xk-resource-dashboard-refresh').click();
  await expect(page.locator('#xk-resource-health-title')).toHaveText('Система в норме');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#xk-resource-export').click();
  const download = await downloadEvent;
  const text = await fs.readFile(await download.path(), 'utf8');
  const snapshot = JSON.parse(text);
  expect(snapshot.resources.cpu.percent).toBe(12.4);
  expect(snapshot.history.length).toBeGreaterThan(0);
  expect(snapshot.refresh_seconds).toBe(0);
  expect(snapshot.stale).toBe(false);
  expect(text).not.toContain('192.0.2.1');
  expect(text).not.toContain('GigabitEthernet');
});

test('missing temperature and unavailable router checks are not zero or healthy', async ({ page }) => {
  const payload = resources();
  payload.temperature_celsius = null;
  payload.router = { internet: { available: false } };
  await page.route('**/api/system/resources', route => route.fulfill({ json: payload }));
  await openDashboard(page);
  await expect(page.locator('#xk-resource-dashboard-temperature')).toHaveText('—');
  await expect(page.locator('#xk-resource-health')).toHaveAttribute('data-tone', 'unknown');
  await expect(page.locator('#xk-resource-health-title')).toHaveText('Телеметрия неполная');
});

for (const width of [1600, 390]) {
  test(`client list toggles between Top-5 and all without another RCI query at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let queries = 0;
    const items = Array.from({ length: 12 }, (_, index) => ({
      name: `client-${index + 1}`, ip: `192.0.2.${index + 1}`, traffic_bytes: 10000 - index,
      rx_rate: 1000000, tx_rate: 1000000,
    }));
    await page.route('**/api/system/resources', route => route.fulfill({ json: resources() }));
    await page.route('**/api/system/router/clients', route => {
      queries++;
      return route.fulfill({ json: { available: true, count: 12, items, top: items.slice(0, 5), sampled_at: Date.now() / 1000 } });
    });
    await openDashboard(page);
    await expect(page.locator('#xk-clients-show-all')).toBeHidden();
    await page.locator('#xk-clients-action').click();
    await expect(page.locator('#xk-client-rows tr')).toHaveCount(5);
    await page.locator('#xk-clients-show-all').click();
    await expect(page.locator('#xk-client-rows tr')).toHaveCount(12);
    await expect(page.locator('#xk-clients-status')).toContainText('12 из 12');
    await page.locator('#xk-clients-show-all').click();
    await expect(page.locator('#xk-client-rows tr')).toHaveCount(5);
    expect(queries).toBe(1);
    await expect(page.locator('#xk-clients-panel')).toHaveJSProperty('open', true);
  });
}

test('missing polling window is labelled and hover does not invent a measurement', async ({ page }) => {
  await page.addInitScript(() => {
    window.__chartLabels = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (this.canvas.id === 'xk-resource-chart-network' && String(text).includes('нет данных')) window.__chartLabels.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  let at = 1792602000;
  await page.route('**/api/system/resources', route => route.fulfill({ json: resources(at) }));
  await openDashboard(page);
  await page.locator('#xk-resource-poll').selectOption('0');
  at += 60;
  await page.evaluate(async () => {
    const { resourceMonitorApi } = await import('/static/js/features/resource_monitor.js');
    await resourceMonitorApi.refresh();
  });
  await expect.poll(() => page.evaluate(() => window.__chartLabels)).toContain('нет данных 60с');
  const chart = page.locator('#xk-resource-chart-network');
  await chart.scrollIntoViewIfNeeded();
  const rect = await chart.boundingBox();
  await chart.dispatchEvent('pointermove', { clientX: rect.x + rect.width / 2, clientY: rect.y + 80 });
  const tooltip = page.locator('[data-chart-card="network"] .xk-resource-chart-tooltip');
  await expect(tooltip).toContainText('Нет данных · 60 с');
  await expect(tooltip).not.toContainText('Приём:');
});
