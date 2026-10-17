import { expect } from './fixtures.mjs';

// Shared by the browser tests of the Xray subscriptions window (subscriptions_modal_*.spec.mjs).

export function buildDemoNodes() {
  const specs = [
    ['🇩🇪 de-XXX-Germany.98.1016', 'xhttp', 'tls', '195.133.25.89', 443, 'path=/api/v2/'],
    ['🇸🇪 se-YYY-Sweden.e026', 'xhttp', 'tls', '103.88.240.173', 443, 'path=/api/v2/'],
    ['🇳🇱 nl-YYY-Netherlands.0005', 'xhttp', 'tls', '176.124.210.220', 443, 'path=/api/v2/'],
    ['us-XXX-New-York.6f10', 'xhttp', 'tls', '72.56.242.135', 443, 'path=/api/v2/'],
    ['es-XXX-Spain.94da', 'xhttp', 'tls', '72.56.244.88', 443, 'path=/api/v2/'],
    ['in-XXX-India.0b95', 'xhttp', 'tls', '72.56.6.163', 443, 'path=/api/v2/'],
    ['tr-XXX-Turkey.0e5d', 'xhttp', 'tls', '5.42.120.157', 443, 'path=/api/v2/'],
    ['kz-ZZZ-Kazakhstan.af40', 'xhttp', 'tls', '82.97.207.21', 443, 'path=/api/v2/'],
    ['de-Germany.0005', 'tcp', 'reality', 'germany-05.ptu.ink', 443, ''],
    ['il-Israel.940f', 'tcp', 'reality', '31.133.100.247', 443, ''],
    ['us-New-York.0002', 'tcp', 'reality', '147.185.239.43', 443, ''],
    ['FREE-WhatsApp-Telegram-02', 'xhttp', 'tls', '45.139.27.63', 443, 'path=/api/v2/'],
    ['Анти-Белые-списки-00.59b7', 'tcp', 'reality', '195.163.211.55', 443, ''],
    ['Анти-Белые-списки-00.d1e0', 'tcp', 'reality', '161.0.40.166', 443, ''],
    ['Анти-Белые-списки-20.70ce', 'xhttp', 'tls', '217.16.217.10', 443, 'path=/api/v2/'],
    ['Анти-Белые-списки-00.dc85', 'tcp', 'reality', '95.163.211.169', 443, ''],
    ['Анти-Белые-списки-78.12a4', 'tcp', 'reality', '185.14.46.76', 443, ''],
    ['Анти-Белые-списки-96.37e9', 'tcp', 'reality', '92.38.156.41', 443, ''],
    ['Анти-Белые-списки-70', 'xhttp', 'reality', '212.111.87.132', 443, ''],
    ['Анти-Белые-списки-71', 'xhttp', 'reality', '185.160.108.209', 443, ''],
    ['Анти-Белые-списки-72', 'xhttp', 'reality', '151.250.1.196', 443, ''],
    ['Анти-Белые-списки-06.e026', 'xhttp', 'tls', '103.88.240.173', 443, 'path=/api/v2/'],
  ];

  return specs.map(([name, transport, security, host, port, detail], index) => ({
    key: `node-${index + 1}`,
    name,
    protocol: 'vless',
    transport,
    security,
    host,
    port,
    detail,
    tag: `cdn.pecan.run--${name}`,
  }));
}

export function buildNodeLatency(nodes) {
  const values = [
    800, 691, 880, 1213, 806, 3050, null, 1640, 941, null, 886,
    430, 1517, 2969, 2693, 1573, 3376, 925, null, null, null, 691,
  ];
  const map = {};
  nodes.forEach((node, index) => {
    const delay = values[index];
    map[node.key] = delay == null
      ? { status: 'error', error: 'timeout', checked_at: 1777777777 }
      : { status: 'ok', delay_ms: delay, checked_at: 1777777777 };
  });
  return map;
}

export function buildDemoSubscription(nodes = buildDemoNodes(), overrides = {}) {
  return {
    id: 'demo-sub',
    name: 'cdn.pecan.run',
    tag: 'cdn.pecan.run',
    url: 'https://cdn.pecan.run/xray/subscription/demo#VNI%20Hosting%20-%20Russia',
    interval_hours: 1,
    profile_update_interval_hours: 1,
    enabled: true,
    ping_enabled: true,
    routing_mode: 'safe-fallback',
    last_ok: true,
    last_count: nodes.length,
    last_source_count: nodes.length,
    last_filtered_out_count: 0,
    next_update_ts: 1777777777,
    output_file: '04_outbounds.cdn.pecan.run.json',
    last_nodes: nodes,
    node_latency: buildNodeLatency(nodes),
    ...overrides,
  };
}

export async function openSubscriptionsModal(page) {
  await page.goto('/');
  const body = page.locator('#outbounds-body');
  for (let attempt = 0; attempt < 3 && !(await body.isVisible()); attempt += 1) {
    await page.locator('#outbounds-header').click();
    await page.waitForTimeout(350);
  }
  await expect(body).toBeVisible();
  await page.locator('#outbounds-subscriptions-btn').click();
  await expect(page.locator('#outbounds-subscriptions-modal')).toBeVisible();
}

export async function selectSubscriptionProbeMode(page, mode) {
  const button = page.locator(`#outbounds-subscriptions-nodes-probe-mode [data-probe-mode="${mode}"]`);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

export async function selectOutboundsProbeMode(page, mode) {
  const button = page.locator(`#outbounds-nodes-probe-mode [data-probe-mode="${mode}"]`);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

export async function openOutboundsPanel(page) {
  await page.goto('/');
  const body = page.locator('#outbounds-body');
  for (let attempt = 0; attempt < 3 && !(await body.isVisible()); attempt += 1) {
    await page.locator('#outbounds-header').click();
    await page.waitForTimeout(350);
  }
  await expect(body).toBeVisible();
}
