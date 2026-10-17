import { test, expect } from './fixtures.mjs';
import {
  buildDemoNodes, buildDemoSubscription, openSubscriptionsModal,
} from './subscriptions_modal_support.mjs';

// Xray subscriptions window: the form, advanced settings, routing controls and
// the workbench at every width.

test('subscriptions advanced settings keep a consistent inner gutter', async ({ page }) => {
  const subscription = buildDemoSubscription();
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription] }),
    });
  });

  await openSubscriptionsModal(page);
  await page.locator('tr[data-sub-id="demo-sub"]').click();
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');
  if (!(await advanced.getAttribute('open'))) await advanced.locator(':scope > summary').click();

  const spacing = await advanced.evaluate((root) => {
    const summary = root.querySelector(':scope > summary');
    const grid = root.querySelector('.xk-sub-advanced-grid');
    const summaryStyle = summary ? window.getComputedStyle(summary) : null;
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    return {
      summaryLeft: summaryStyle ? Number.parseFloat(summaryStyle.paddingLeft) : 0,
      summaryRight: summaryStyle ? Number.parseFloat(summaryStyle.paddingRight) : 0,
      gridLeft: gridStyle ? Number.parseFloat(gridStyle.paddingLeft) : 0,
      gridRight: gridStyle ? Number.parseFloat(gridStyle.paddingRight) : 0,
      gridBottom: gridStyle ? Number.parseFloat(gridStyle.paddingBottom) : 0,
    };
  });

  expect(spacing.summaryLeft).toBeGreaterThanOrEqual(12);
  expect(spacing.summaryRight).toBeGreaterThanOrEqual(12);
  expect(spacing.gridLeft).toBeGreaterThanOrEqual(12);
  expect(spacing.gridRight).toBeGreaterThanOrEqual(12);
  expect(spacing.gridBottom).toBeGreaterThanOrEqual(12);
});

test('subscriptions form uses icon-only actions, visible switches, and themed advanced controls', async ({ page }) => {
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [] }),
    });
  });

  await openSubscriptionsModal(page);

  const contract = await page.evaluate(() => {
    const iconName = (node) => String(node?.querySelector('use')?.getAttribute('href') || '').split('#xk-').pop();
    const actionIds = [
      'outbounds-subscriptions-preview-btn',
      'outbounds-subscriptions-reset-btn',
      'outbounds-subscriptions-save-btn',
    ];
    const checkIds = [
      'outbounds-subscriptions-enabled',
      'outbounds-subscriptions-ping',
      'outbounds-subscriptions-refresh-now',
      'outbounds-subscriptions-routing-auto-rule',
    ];
    const advanced = document.querySelector('#outbounds-subscriptions-modal .xk-sub-advanced');
    const caret = advanced?.querySelector('.xk-sub-advanced-caret');
    advanced?.querySelector('summary')?.click();
    return {
      actions: actionIds.map((id) => {
        const node = document.getElementById(id);
        return { id, label: node?.getAttribute('aria-label'), text: String(node?.textContent || '').trim(), icon: iconName(node) };
      }),
      checks: checkIds.map((id) => {
        const input = document.getElementById(id);
        const label = input?.closest('.xk-sub-check');
        const labelRect = label?.getBoundingClientRect();
        const slider = label?.querySelector('.dt-switch-slider');
        const sliderRect = slider?.getBoundingClientRect();
        return {
          id,
          label: label?.getAttribute('aria-label'),
          inputLabel: input?.getAttribute('aria-label'),
          text: String(label?.textContent || '').trim(),
          inputOpacity: input ? window.getComputedStyle(input).opacity : '',
          sliderOffset: sliderRect && labelRect ? Math.round(sliderRect.left - labelRect.left) : -1,
          sliderWidth: sliderRect ? Math.round(sliderRect.width) : 0,
        };
      }),
      hasCaret: !!caret,
      advancedOpen: !!advanced?.open,
    };
  });

  expect(contract.actions).toEqual([
    { id: 'outbounds-subscriptions-preview-btn', label: 'Скачать подписку (предпросмотр)', text: '', icon: 'download' },
    // Кольцо со стрелкой читалось как «обновить» и спорило с соседней кнопкой
    // обновления; метла ни с чем не путается.
    { id: 'outbounds-subscriptions-reset-btn', label: 'Очистить форму', text: '', icon: 'broom' },
    { id: 'outbounds-subscriptions-save-btn', label: 'Сохранить настройки', text: '', icon: 'save' },
  ]);
  expect(contract.checks).toEqual([
    expect.objectContaining({ id: 'outbounds-subscriptions-enabled', label: 'Авто', inputLabel: 'Авто', text: 'Автообн.', inputOpacity: '0' }),
    expect.objectContaining({ id: 'outbounds-subscriptions-ping', label: 'Замер', inputLabel: 'Замер', text: 'Замер', inputOpacity: '0' }),
    expect.objectContaining({ id: 'outbounds-subscriptions-refresh-now', label: 'Обновить', inputLabel: 'Обновить', text: 'Сразу', inputOpacity: '0' }),
    expect.objectContaining({ id: 'outbounds-subscriptions-routing-auto-rule', label: 'Пул', inputLabel: 'Пул', text: 'Пул', inputOpacity: '0' }),
  ]);
  for (const check of contract.checks) {
    expect(check.sliderOffset).toBeGreaterThanOrEqual(9);
    expect(check.sliderWidth).toBeGreaterThanOrEqual(30);
  }
  expect(contract.hasCaret).toBe(true);
  expect(contract.advancedOpen).toBe(true);
});

// «Пул» — это leastPing-балансировщик: без «Замера» ему не по чему выбирать,
// и Xray уводит трафик в fallbackTag (direct). Поэтому «Пул» включает «Замер»
// и не даёт его выключить, а старую сохранённую пару «Пул без замера»
// окно не чинит молча, а показывает предупреждение.
test('subscription pool keeps latency probing on and warns about a pool without it', async ({ page }) => {
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [] }),
    });
  });

  await openSubscriptionsModal(page);
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');
  await advanced.locator(':scope > summary').click();
  await expect(advanced).toHaveAttribute('open', '');

  const ping = page.locator('#outbounds-subscriptions-ping');
  const pool = page.locator('#outbounds-subscriptions-routing-auto-rule');
  const poolLabel = pool.locator('xpath=ancestor::label[1]');
  const pingLabel = ping.locator('xpath=ancestor::label[1]');
  const warning = page.locator('#outbounds-subscriptions-pool-warning');

  await expect(pool).toBeChecked();
  await expect(ping).toBeChecked();
  await expect(ping).toBeDisabled();
  await expect(warning).toBeHidden();
  await expect(pingLabel).toHaveAttribute('data-tooltip', /«Замер» выключить нельзя/);

  await poolLabel.click();
  await expect(pool).not.toBeChecked();
  await expect(ping).toBeEnabled();
  await pingLabel.click();
  await expect(ping).not.toBeChecked();
  await expect(warning).toBeHidden();

  await poolLabel.click();
  await expect(pool).toBeChecked();
  await expect(ping).toBeChecked();
  await expect(ping).toBeDisabled();

  // Так выглядит подписка, сохранённая до появления блокировки.
  await page.evaluate(() => {
    const input = document.getElementById('outbounds-subscriptions-ping');
    input.disabled = false;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('пустит трафик напрямую');
  await expect(ping).toBeEnabled();
  await pingLabel.click();
  await expect(ping).toBeChecked();
  await expect(warning).toBeHidden();

  await poolLabel.hover();
  const bubble = page.locator('#xk-tooltip-portal .xk-tooltip-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveClass(/is-multiline/);
  await expect(bubble).toHaveCSS('white-space', 'pre-line');
  const tipText = await bubble.locator('.xk-tooltip-text').textContent();
  // Абзацы разделены пустой строкой: заголовок, пусто, первый абзац.
  const tipLines = tipText.split('\n');
  expect(tipLines[0]).toBe('Пускать трафик через самый быстрый узел');
  expect(tipLines[1]).toBe('');
  expect(tipLines[2]).toMatch(/^Узлы подписки попадают/);
  expect(tipText).not.toMatch(/\n\n\n/);
});

test('subscriptions routing controls stay compact and balancers wrap as tiles', async ({ page }) => {
  const subscription = buildDemoSubscription([], {
    routing_balancer_tags: ['proxy-eu', 'proxy-us'],
  });
  const routingBalancers = [
    { tag: 'proxy-eu', strategy_type: 'leastPing', fallback_tag: 'direct', selector_count: 4 },
    { tag: 'proxy-us', strategy_type: 'leastPing', fallback_tag: 'direct', selector_count: 6 },
    { tag: 'media-streaming', strategy_type: 'leastLoad', fallback_tag: '', selector_count: 3 },
    { tag: 'gaming', strategy_type: 'leastPing', fallback_tag: 'proxy', selector_count: 2 },
    { tag: 'long-balancer-name-for-layout-check', strategy_type: 'leastPing', fallback_tag: 'direct', selector_count: 9 },
  ];
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription], routing_balancers: routingBalancers }),
    });
  });

  await openSubscriptionsModal(page);
  await page.locator('tr[data-sub-id="demo-sub"]').click();
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');
  if (!(await advanced.getAttribute('open'))) await advanced.locator(':scope > summary').click();
  await expect(page.locator('#outbounds-subscriptions-routing-balancers .xk-sub-balancer-check')).toHaveCount(routingBalancers.length);

  const layout = await page.evaluate(() => {
    const root = document.querySelector('#outbounds-subscriptions-routing-balancers');
    const mode = document.querySelector('#outbounds-subscriptions-routing-mode');
    const modeLabel = document.querySelector('.xk-sub-routing-mode .xk-sub-inline-label');
    const cards = Array.from(root?.querySelectorAll('.xk-sub-balancer-check') || []);
    const rootRect = root?.getBoundingClientRect();
    const modeRect = mode?.getBoundingClientRect();
    const modeLabelRect = modeLabel?.getBoundingClientRect();
    const cardsMeta = cards.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const input = card.querySelector('input');
      const checkRect = input?.getBoundingClientRect();
      const copyRect = card.querySelector('.xk-sub-balancer-copy')?.getBoundingClientRect();
      const inputStyle = input ? window.getComputedStyle(input) : null;
      const cardStyle = window.getComputedStyle(card);
      return {
        left: Math.round(cardRect.left),
        width: Math.round(cardRect.width),
        checkboxTop: checkRect && copyRect ? Math.round(checkRect.top - copyRect.top) : -99,
        checked: !!input?.checked,
        checkboxOpacity: inputStyle ? inputStyle.opacity : '',
        checkboxWidth: checkRect ? Math.round(checkRect.width) : 0,
        checkboxBackground: inputStyle ? inputStyle.backgroundColor : '',
        cardBackground: cardStyle.backgroundColor,
      };
    });
    return {
      rootWidth: rootRect ? Math.round(rootRect.width) : 0,
      modeWidth: modeRect ? Math.round(modeRect.width) : 0,
      modeLabelAboveSelect: !!(modeLabelRect && modeRect && modeLabelRect.bottom <= modeRect.top + 1),
      modeAlignedWithBalancers: !!(rootRect && modeRect && Math.abs(rootRect.left - modeRect.left) <= 1),
      columns: new Set(cardsMeta.map((item) => item.left)).size,
      cards: cardsMeta,
    };
  });

  expect(layout.modeWidth).toBeLessThanOrEqual(250);
  expect(layout.modeWidth).toBeLessThan(layout.rootWidth * 0.6);
  expect(layout.modeLabelAboveSelect).toBe(true);
  expect(layout.modeAlignedWithBalancers).toBe(true);
  expect(layout.columns).toBeGreaterThanOrEqual(2);
  expect(layout.cards.every((card) => card.width <= 282)).toBe(true);
  expect(layout.cards.every((card) => card.checkboxTop >= 0 && card.checkboxTop <= 6)).toBe(true);
  expect(layout.cards.every((card) => card.checkboxOpacity === '1')).toBe(true);
  expect(layout.cards.every((card) => card.checkboxWidth >= 16)).toBe(true);
  const selectedCards = layout.cards.filter((card) => card.checked);
  const unselectedCards = layout.cards.filter((card) => !card.checked);
  expect(selectedCards.length).toBe(2);
  expect(unselectedCards.length).toBeGreaterThan(0);
  expect(selectedCards[0].checkboxBackground).not.toBe(unselectedCards[0].checkboxBackground);
  expect(selectedCards[0].cardBackground).not.toBe(unselectedCards[0].cardBackground);
});

test('subscriptions workbench collapses empty rows and keeps refresh due in the list header', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const nodes = buildDemoNodes().slice(0, 7);
  const subscription = buildDemoSubscription(nodes);
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription] }),
    });
  });

  await openSubscriptionsModal(page);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.locator('tr[data-sub-id="demo-sub"]').click();
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');
  if (!(await advanced.getAttribute('open'))) await advanced.locator(':scope > summary').click();

  const layout = await page.evaluate(() => {
    const modal = document.querySelector('#outbounds-subscriptions-modal .xk-sub-modal');
    const listPanel = document.querySelector('#outbounds-subscriptions-modal .xk-sub-list-panel');
    const panelHead = listPanel?.querySelector('.xk-sub-panelhead');
    const due = document.querySelector('#outbounds-subscriptions-refresh-due-btn');
    const align = document.querySelector('#outbounds-subscriptions-align-btn');
    const tableWrap = document.querySelector('#outbounds-subscriptions-modal .xk-sub-tablewrap');
    const table = tableWrap?.querySelector('table');
    const nodesList = document.querySelector('#outbounds-subscriptions-nodes-list');
    const cards = Array.from(nodesList?.querySelectorAll('.xk-sub-node-item') || []);
    const hiddenNotes = Array.from(document.querySelectorAll('#outbounds-subscriptions-form .xk-sub-field-note[hidden]'));
    const modalRect = modal?.getBoundingClientRect();
    const headRect = panelHead?.getBoundingClientRect();
    const dueRect = due?.getBoundingClientRect();
    const alignRect = align?.getBoundingClientRect();
    const tableRect = table?.getBoundingClientRect();
    const wrapRect = tableWrap?.getBoundingClientRect();
    const listRect = nodesList?.getBoundingClientRect();
    const cardBottom = cards.length
      ? Math.max(...cards.map((card) => card.getBoundingClientRect().bottom))
      : 0;
    return {
      modalHeight: modalRect ? Math.round(modalRect.height) : 0,
      dueInsideHead: !!(headRect && dueRect && dueRect.top >= headRect.top - 1 && dueRect.bottom <= headRect.bottom + 1),
      alignInsideHead: !!(headRect && alignRect && alignRect.top >= headRect.top - 1 && alignRect.bottom <= headRect.bottom + 1),
      // Заголовок списка несёт счётчик и две кнопки: они обязаны остаться внутри панели.
      alignWithinPanel: (() => {
        const panelRect = listPanel?.getBoundingClientRect();
        return !!(panelRect && alignRect && alignRect.right <= panelRect.right + 1);
      })(),
      // Dead space left under the table inside its own column, status line aside.
      columnSlack: (() => {
        const panelRect = listPanel?.getBoundingClientRect();
        const status = document.querySelector('#outbounds-subscriptions-status');
        const statusHeight = status ? status.getBoundingClientRect().height : 0;
        return panelRect && wrapRect ? Math.round(panelRect.bottom - wrapRect.bottom - statusHeight) : 999;
      })(),
      nodeSlack: listRect && cardBottom ? Math.round(listRect.bottom - cardBottom) : 999,
      hiddenNotesVisible: hiddenNotes.filter((note) => window.getComputedStyle(note).display !== 'none').length,
    };
  });

  expect(layout.dueInsideHead).toBe(true);
  expect(layout.alignInsideHead).toBe(true);
  expect(layout.alignWithinPanel).toBe(true);
  // The table wrapper fills its column instead of collapsing around the rows.
  expect(layout.columnSlack).toBeLessThanOrEqual(24);
  expect(layout.nodeSlack).toBeLessThanOrEqual(3);
  expect(layout.hiddenNotesVisible).toBe(0);
  expect(layout.modalHeight).toBeLessThan(1000);
});

test('subscriptions help expands below its summary without a blank split column', async ({ page }) => {
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [] }),
    });
  });

  await openSubscriptionsModal(page);
  await page.locator('#outbounds-subscriptions-modal .xk-sub-brief > summary').click();

  const layout = await page.evaluate(() => {
    const details = document.querySelector('#outbounds-subscriptions-modal .xk-sub-brief');
    const summary = details ? details.querySelector(':scope > summary') : null;
    const content = details ? details.querySelector('.xk-sub-brief-content') : null;
    const detailsRect = details ? details.getBoundingClientRect() : null;
    const summaryRect = summary ? summary.getBoundingClientRect() : null;
    const contentRect = content ? content.getBoundingClientRect() : null;
    return {
      display: details ? window.getComputedStyle(details).display : '',
      contentBelowSummary: !!(summaryRect && contentRect && contentRect.top >= summaryRect.bottom - 1),
      contentWidth: contentRect ? Math.round(contentRect.width) : 0,
      detailsWidth: detailsRect ? Math.round(detailsRect.width) : 0,
    };
  });

  expect(layout.display).toBe('block');
  expect(layout.contentBelowSummary).toBe(true);
  expect(layout.contentWidth).toBeGreaterThanOrEqual(layout.detailsWidth - 4);
});

test('subscriptions modal checkboxes use the Operator accent in both themes', async ({ page }) => {
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [] }),
    });
  });

  await openSubscriptionsModal(page);

  const readTheme = async (theme) => page.evaluate(async (nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    const input = document.querySelector('#outbounds-subscriptions-enabled');
    const label = input ? input.closest('.xk-sub-check') : null;
    const slider = label ? label.querySelector('.dt-switch-slider') : null;
    if (slider) slider.style.transition = 'none';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const bodyStyle = window.getComputedStyle(document.body);
    const inputStyle = input ? window.getComputedStyle(input) : null;
    const labelStyle = label ? window.getComputedStyle(label) : null;
    const sliderStyle = slider ? window.getComputedStyle(slider) : null;
    const swatch = document.createElement('span');
    swatch.style.backgroundColor = bodyStyle.getPropertyValue('--op-accent').trim();
    document.body.appendChild(swatch);
    const resolvedAccent = window.getComputedStyle(swatch).backgroundColor;
    swatch.remove();
    return {
      inputOpacity: inputStyle ? inputStyle.opacity : '',
      sliderBackground: sliderStyle ? sliderStyle.backgroundColor : '',
      labelBackground: labelStyle ? labelStyle.backgroundColor : '',
      resolvedAccent,
    };
  }, theme);

  const dark = await readTheme('dark');
  const light = await readTheme('light');

  for (const state of [dark, light]) {
    expect(state.inputOpacity).toBe('0');
    expect(state.sliderBackground).toBe(state.resolvedAccent);
    expect(state.labelBackground).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(dark.resolvedAccent).not.toBe(light.resolvedAccent);
});

test('subscriptions modal keeps its workbench frame available on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [] }),
    });
  });

  await openSubscriptionsModal(page);

  const layout = await page.evaluate(() => {
    const modal = document.querySelector('#outbounds-subscriptions-modal .xk-sub-modal');
    const header = modal ? modal.querySelector('.modal-header') : null;
    const body = modal ? modal.querySelector('.modal-body') : null;
    const modalRect = modal ? modal.getBoundingClientRect() : null;
    const headerRect = header ? header.getBoundingClientRect() : null;
    return {
      width: modalRect ? Math.round(modalRect.width) : 0,
      height: modalRect ? Math.round(modalRect.height) : 0,
      bodyOverflowY: body ? window.getComputedStyle(body).overflowY : '',
      headerInside: !!(modalRect && headerRect && headerRect.top >= modalRect.top && headerRect.bottom <= modalRect.bottom),
      topClose: modal ? modal.querySelectorAll('#outbounds-subscriptions-close-btn').length : 0,
      duplicateClose: modal ? modal.querySelectorAll('#outbounds-subscriptions-cancel-btn').length : 0,
      footer: modal ? modal.querySelector('.modal-actions') : null,
    };
  });

  expect(layout.width).toBeGreaterThanOrEqual(374);
  expect(layout.height).toBeLessThanOrEqual(828);
  expect(['auto', 'scroll']).toContain(layout.bodyOverflowY);
  expect(layout.headerInside).toBe(true);
  expect(layout.topClose).toBe(1);
  expect(layout.duplicateClose).toBe(0);
  expect(layout.footer).toBeNull();
});

test('subscriptions modal does not reserve an empty desktop canvas without nodes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [] }),
    });
  });

  await openSubscriptionsModal(page);

  const layout = await page.evaluate(() => {
    const modal = document.querySelector('#outbounds-subscriptions-modal .xk-sub-modal');
    const body = modal ? modal.querySelector('.modal-body') : null;
    const modalRect = modal ? modal.getBoundingClientRect() : null;
    return {
      height: modalRect ? Math.round(modalRect.height) : 0,
      bodyScrollHeight: body ? Math.round(body.scrollHeight) : 0,
      hasNodes: !!document.querySelector('#outbounds-subscriptions-nodes-list .xk-sub-node-item'),
    };
  });

  expect(layout.hasNodes).toBe(false);
  expect(layout.height).toBeLessThan(760);
  expect(layout.height).toBeGreaterThanOrEqual(layout.bodyScrollHeight);
});

test('subscriptions modal ping-all button shows compact spinner while probing', async ({ page }) => {
  const nodes = buildDemoNodes();
  const subscription = buildDemoSubscription(nodes);
  let releaseBulkProbe;
  let resolveBulkProbeStarted;
  const bulkProbeStarted = new Promise((resolve) => {
    resolveBulkProbeStarted = resolve;
  });
  await page.route('**/api/xray/subscriptions/demo-sub/nodes/ping-bulk', async (route) => {
    expect(route.request().postDataJSON()).toEqual(expect.objectContaining({ mode: 'tcp' }));
    resolveBulkProbeStarted();
    await new Promise((resume) => {
      releaseBulkProbe = resume;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        requested: nodes.length,
        ok_count: nodes.length,
        failed_count: 0,
        results: nodes.map((node, index) => ({
          node_key: node.key,
          entry: {
            status: 'ok',
            delay_ms: 120 + index,
            checked_at: 1777778888,
          },
        })),
      }),
    });
  });

  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription] }),
    });
  });

  await openSubscriptionsModal(page);
  await page.locator('tr[data-sub-id="demo-sub"]').click();

  const pingAllBtn = page.locator('#outbounds-subscriptions-nodes-pingall');
  await expect(pingAllBtn).toBeEnabled();
  await pingAllBtn.click();
  await bulkProbeStarted;
  await expect(pingAllBtn).toHaveClass(/is-busy/);
  await expect(pingAllBtn).toHaveAttribute('aria-busy', 'true');
  // The glyph fades through a CSS transition; wait for the settled state
  // instead of sampling at an arbitrary point in that transition.
  await expect.poll(() => pingAllBtn.evaluate((button) => {
    const glyph = button.querySelector('.xk-sub-pingall-glyph');
    return glyph ? Number.parseFloat(window.getComputedStyle(glyph).opacity) : 0;
  })).toBeLessThan(0.15);

  const busyState = await pingAllBtn.evaluate((button) => {
    const glyph = button.querySelector('.xk-sub-pingall-glyph');
    const spinner = button.querySelector('.xk-sub-pingall-spinner');
    const glyphStyle = glyph ? window.getComputedStyle(glyph) : null;
    const spinnerStyle = spinner ? window.getComputedStyle(spinner) : null;
    return {
      disabled: button.disabled,
      glyphOpacity: glyphStyle ? glyphStyle.opacity : '',
      spinnerOpacity: spinnerStyle ? spinnerStyle.opacity : '',
      spinnerAnimation: spinnerStyle ? spinnerStyle.animationName : '',
    };
  });

  expect(busyState.disabled).toBe(true);
  expect(Number(busyState.glyphOpacity)).toBeLessThan(0.15);
  expect(Number(busyState.spinnerOpacity)).toBeGreaterThan(0.95);
  expect(Number(busyState.spinnerOpacity)).toBeGreaterThan(Number(busyState.glyphOpacity));
  expect(busyState.spinnerAnimation).toBe('xk-sub-pingall-spin');

  releaseBulkProbe();
  await expect(pingAllBtn).not.toHaveClass(/is-busy/);
  await expect(pingAllBtn).not.toHaveAttribute('aria-busy', /./);
});

test('subscriptions fragment list grows into the free column height', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const nodes = buildDemoNodes().slice(0, 3);
  const subscriptions = Array.from({ length: 8 }, (_, index) =>
    buildDemoSubscription(nodes, {
      id: `demo-sub-${index}`,
      name: `VPS_SUB_${index}`,
      tag: `VPS_SUB_${index}`,
      output_file: `04_outbounds.vps_sub_${index}.json`,
    })
  );
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions }),
    });
  });

  await openSubscriptionsModal(page);
  await expect(page.locator('tr[data-sub-id="demo-sub-0"]')).toBeVisible();
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');
  if (!(await advanced.getAttribute('open'))) await advanced.locator(':scope > summary').click();

  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#outbounds-subscriptions-modal .xk-sub-list-panel');
    const wrap = document.querySelector('#outbounds-subscriptions-modal .xk-sub-tablewrap');
    const table = wrap?.querySelector('table');
    const panelRect = panel?.getBoundingClientRect();
    const wrapRect = wrap?.getBoundingClientRect();
    const tableRect = table?.getBoundingClientRect();
    return {
      wrapHeight: wrapRect ? Math.round(wrapRect.height) : 0,
      tableHeight: tableRect ? Math.round(tableRect.height) : 0,
      panelHeight: panelRect ? Math.round(panelRect.height) : 0,
      wrapInsidePanel: !!(panelRect && wrapRect && wrapRect.bottom <= panelRect.bottom + 1),
    };
  });

  // The old build pinned the wrapper at 190px regardless of the free space.
  expect(layout.wrapHeight).toBeGreaterThan(240);
  expect(layout.wrapHeight).toBeLessThan(layout.panelHeight);
  expect(layout.wrapInsidePanel).toBe(true);
  expect(layout.tableHeight).toBeGreaterThan(0);
});

test('subscriptions window scrolls as a whole so every server is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const base = buildDemoNodes();
  const nodes = Array.from({ length: 120 }, (_, index) => ({
    ...base[index % base.length],
    key: `bulk-node-${index + 1}`,
    name: `Bulk server ${index + 1}`,
    tag: `demo-sub--bulk-node-${index + 1}`,
  }));
  const subscription = buildDemoSubscription(nodes);
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription] }),
    });
  });

  await openSubscriptionsModal(page);
  await page.locator('tr[data-sub-id="demo-sub"]').click();
  await expect(page.locator('#outbounds-subscriptions-nodes-list .xk-sub-node-item')).toHaveCount(nodes.length);

  // The click scrolls the window down to the servers on its own.
  const readScrollTop = () => page.evaluate(() => {
    const body = document.querySelector('#outbounds-subscriptions-modal .modal-body');
    return body ? Math.round(body.scrollTop) : 0;
  });
  await expect.poll(readScrollTop).toBeGreaterThan(0);
  // Smooth scrolling is still animating right after the click: wait for it to settle.
  await expect
    .poll(async () => {
      const first = await readScrollTop();
      await page.waitForTimeout(80);
      const second = await readScrollTop();
      return first === second ? 'settled' : 'moving';
    })
    .toBe('settled');

  const layout = await page.evaluate(() => {
    const body = document.querySelector('#outbounds-subscriptions-modal .modal-body');
    const list = document.querySelector('#outbounds-subscriptions-nodes-list');
    const panel = document.querySelector('#outbounds-subscriptions-nodes-panel');
    const head = panel?.querySelector('.xk-sub-panelhead');
    const bodyRect = body?.getBoundingClientRect();
    return {
      bodyScrolls: !!(body && body.scrollHeight > body.clientHeight + 1),
      listOwnScroll: !!(list && list.scrollHeight > list.clientHeight + 1),
      listOverflow: list ? window.getComputedStyle(list).overflowY : '',
      headPosition: head ? window.getComputedStyle(head).position : '',
      lastCardBelowFold: (() => {
        const cards = document.querySelectorAll('#outbounds-subscriptions-nodes-list .xk-sub-node-item');
        const last = cards[cards.length - 1];
        const rect = last?.getBoundingClientRect();
        return !!(rect && bodyRect && rect.bottom > bodyRect.bottom);
      })(),
    };
  });

  // The list itself no longer scrolls: the window does, so the servers are
  // reached by scrolling past the form and the fragment table.
  expect(layout.listOwnScroll).toBe(false);
  expect(layout.listOverflow).toBe('visible');
  expect(layout.bodyScrolls).toBe(true);
  expect(layout.headPosition).toBe('sticky');
  expect(layout.lastCardBelowFold).toBe(true);

  // Scrolling to the bottom brings the last server fully into view.
  await page.evaluate(() => {
    const body = document.querySelector('#outbounds-subscriptions-modal .modal-body');
    if (body) body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(120);
  const bottom = await page.evaluate(() => {
    const body = document.querySelector('#outbounds-subscriptions-modal .modal-body');
    const cards = document.querySelectorAll('#outbounds-subscriptions-nodes-list .xk-sub-node-item');
    const last = cards[cards.length - 1];
    const head = document.querySelector('#outbounds-subscriptions-nodes-panel .xk-sub-panelhead');
    const bodyRect = body?.getBoundingClientRect();
    const rect = last?.getBoundingClientRect();
    const headRect = head?.getBoundingClientRect();
    return {
      lastVisible: !!(rect && bodyRect && rect.bottom <= bodyRect.bottom + 1 && rect.top >= bodyRect.top - 1),
      // The heading keeps naming the subscription while the list scrolls past it.
      headPinned: !!(bodyRect && headRect && Math.abs(headRect.top - bodyRect.top) <= 2),
    };
  });
  expect(bottom.lastVisible).toBe(true);
  expect(bottom.headPinned).toBe(true);
});

test('subscriptions fragment table fills the free height of its column', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const nodes = buildDemoNodes().slice(0, 2);
  const subscriptions = Array.from({ length: 8 }, (_, index) =>
    buildDemoSubscription(nodes, {
      id: `fill-sub-${index}`,
      name: `VPS_FILL_${index}`,
      tag: `VPS_FILL_${index}`,
      output_file: `04_outbounds.vps_fill_${index}.json`,
      // Скачанная подписка всегда несёт время скачивания; без него строка
      // показывала бы «Не скачана» с более длинной подсказкой.
      last_update_ts: Math.floor(Date.now() / 1000) - 600,
    })
  );
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions }),
    });
  });

  await openSubscriptionsModal(page);
  await expect(page.locator('tr[data-sub-id="fill-sub-0"]')).toBeVisible();
  // The form column is the tall one once its advanced block is open: that is the
  // height the table has to fill instead of leaving a dead zone underneath.
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');
  if (!(await advanced.getAttribute('open'))) await advanced.locator(':scope > summary').click();
  await page.waitForTimeout(150);

  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#outbounds-subscriptions-modal .xk-sub-list-panel');
    const wrap = document.querySelector('#outbounds-subscriptions-modal .xk-sub-tablewrap');
    const status = document.querySelector('#outbounds-subscriptions-status');
    const panelRect = panel?.getBoundingClientRect();
    const wrapRect = wrap?.getBoundingClientRect();
    const statusRect = status?.getBoundingClientRect();
    const statusHeight = statusRect ? statusRect.height : 0;
    return {
      panelHeight: panelRect ? Math.round(panelRect.height) : 0,
      wrapHeight: wrapRect ? Math.round(wrapRect.height) : 0,
      // Dead space between the table and the bottom of its column.
      gap: (panelRect && wrapRect) ? Math.round(panelRect.bottom - wrapRect.bottom - statusHeight) : 999,
      visibleRows: (() => {
        const rows = Array.from(document.querySelectorAll('#outbounds-subscriptions-tbody tr[data-sub-id]'));
        if (!wrapRect) return 0;
        return rows.filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= wrapRect.top - 1 && rect.bottom <= wrapRect.bottom + 1;
        }).length;
      })(),
    };
  });

  // The old build capped the table at 40dvh and left the rest of the column empty.
  expect(layout.wrapHeight).toBeGreaterThan(500);
  expect(layout.gap).toBeLessThanOrEqual(24);
  expect(layout.visibleRows).toBeGreaterThan(3);
});

test('subscriptions advanced settings remember their expanded state', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const subscription = buildDemoSubscription();
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription] }),
    });
  });

  await openSubscriptionsModal(page);
  const advanced = page.locator('#outbounds-subscriptions-modal .xk-sub-advanced');

  // A first visit keeps the block collapsed so the modal opens compact.
  await expect(advanced).not.toHaveAttribute('open', '');

  await advanced.locator(':scope > summary').click();
  await expect(advanced).toHaveAttribute('open', '');

  // Reopening the modal keeps the operator's choice.
  await page.locator('#outbounds-subscriptions-close-btn').click();
  await expect(page.locator('#outbounds-subscriptions-modal')).toBeHidden();
  await page.locator('#outbounds-subscriptions-btn').click();
  await expect(page.locator('#outbounds-subscriptions-modal')).toBeVisible();
  await expect(advanced).toHaveAttribute('open', '');

  // And it survives a full page reload.
  await page.reload();
  await openSubscriptionsModal(page);
  await expect(page.locator('#outbounds-subscriptions-modal .xk-sub-advanced')).toHaveAttribute('open', '');

  // Collapsing is remembered too.
  await page.locator('#outbounds-subscriptions-modal .xk-sub-advanced > summary').click();
  await page.locator('#outbounds-subscriptions-close-btn').click();
  await page.locator('#outbounds-subscriptions-btn').click();
  await expect(page.locator('#outbounds-subscriptions-modal .xk-sub-advanced')).not.toHaveAttribute('open', '');
});

test('subscriptions status spinner is centred on the first line of text', async ({ page }) => {
  const nodes = buildDemoNodes();
  const subscription = buildDemoSubscription(nodes);
  let releaseBulkProbe;
  let resolveBulkProbeStarted;
  const bulkProbeStarted = new Promise((resolve) => {
    resolveBulkProbeStarted = resolve;
  });
  await page.route('**/api/xray/subscriptions/demo-sub/nodes/ping-bulk', async (route) => {
    resolveBulkProbeStarted();
    await new Promise((resume) => {
      releaseBulkProbe = resume;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, requested: nodes.length, ok_count: nodes.length, failed_count: 0, results: [] }),
    });
  });
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [subscription] }),
    });
  });

  await openSubscriptionsModal(page);
  await page.locator('tr[data-sub-id="demo-sub"]').click();
  await page.locator('#outbounds-subscriptions-nodes-pingall').click();
  await bulkProbeStarted;

  const busy = page.locator('#outbounds-subscriptions-status .xk-status-inline.is-busy');
  await expect(busy).toBeVisible();

  const geometry = await busy.evaluate((wrap) => {
    const spinner = wrap.querySelector('.xk-inline-spinner');
    const message = wrap.querySelector('.xk-status-message');
    const spinnerRect = spinner.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(message);
    const firstLine = range.getClientRects()[0];
    return {
      spinnerCentre: spinnerRect.top + spinnerRect.height / 2,
      firstLineCentre: firstLine.top + firstLine.height / 2,
    };
  });

  // Тот же кружок и та же строка статуса, что и в окне импорта Mihomo:
  // общий класс .xk-inline-spinner, поэтому сторожим обе точки применения.
  expect(Math.abs(geometry.spinnerCentre - geometry.firstLineCentre)).toBeLessThanOrEqual(1);

  releaseBulkProbe();
});


// Кнопки списка равняются на окно Mihomo: глиф слева, подпись справа, всё в
// одну строку. Замеряем геометрию, а не наличие классов: правило может быть
// перебито соседним, и разметка при этом выглядит правильной.
test('subscriptions list buttons carry a glyph beside their label', async ({ page }) => {
  await page.route('**/api/xray/subscriptions', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, subscriptions: [buildDemoSubscription()] }),
    });
  });

  await openSubscriptionsModal(page);

  const seen = await page.evaluate(() => {
    const ids = ['outbounds-subscriptions-refresh-due-btn', 'outbounds-subscriptions-align-btn'];
    return ids.map((id) => {
      const node = document.getElementById(id);
      const icon = node?.querySelector('.xk-action-icon');
      const label = node?.querySelector('.xk-action-label');
      const iconRect = icon?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      return {
        id,
        icon: String(icon?.querySelector('use')?.getAttribute('href') || '').split('#xk-').pop(),
        text: String(label?.textContent || '').trim(),
        iconWidth: iconRect ? Math.round(iconRect.width) : 0,
        display: node ? window.getComputedStyle(node).display : '',
        // Глиф стоит перед подписью и не наезжает на неё.
        glyphLeads: !!(iconRect && labelRect && iconRect.right <= labelRect.left + 1),
        gap: iconRect && labelRect ? Math.round(labelRect.left - iconRect.right) : -1,
        sameRow: !!(iconRect && labelRect && Math.abs(
          (iconRect.top + iconRect.height / 2) - (labelRect.top + labelRect.height / 2)
        ) <= 2),
      };
    });
  });

  expect(seen.map((item) => ({ id: item.id, icon: item.icon, text: item.text }))).toEqual([
    { id: 'outbounds-subscriptions-refresh-due-btn', icon: 'refresh', text: 'Обновить просроченные' },
    { id: 'outbounds-subscriptions-align-btn', icon: 'normalize', text: 'Выровнять расписание' },
  ]);
  for (const item of seen) {
    expect(item.iconWidth).toBe(16);
    // Раскладка держится на flex-контейнере самой кнопки, а не на случайном
    // переносе строки: закрепляем это явно.
    expect(['flex', 'inline-flex']).toContain(item.display);
    expect(item.glyphLeads).toBe(true);
    expect(item.sameRow).toBe(true);
    expect(item.gap).toBeGreaterThanOrEqual(4);
    expect(item.gap).toBeLessThanOrEqual(10);
  }
});
