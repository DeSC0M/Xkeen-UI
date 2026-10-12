import { test, expect, selectPanelView } from './fixtures.mjs';


const QUICK_COMMANDS = [
  ['ip a', 'Интерфейсы и адреса'],
  ['ip r', 'Таблица маршрутизации'],
  ['ip rule', 'Policy routing rules'],
  ['iptables -t mangle -S', 'Mangle правила (TPROXY/mark)'],
  ['nslookup ...', 'DNS lookup (замени домен)'],
  ['ping -c 3 ...', 'Проверка ICMP (замени адрес)'],
  ['sysmon --full', 'Мониторинг (расширенная диагностика)'],
];


async function openTerminal(page) {
  await page.goto('/');
  await selectPanelView(page, 'commands');
  const openButton = page.locator(
    '#terminal-open-shell-btn:visible:not([disabled]), #terminal-open-pty-btn:visible:not([disabled])',
  ).first();
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(page.locator('#terminal-overlay')).toBeVisible();
}


test.describe('Terminal quick commands menu', () => {
  test('renders each command as a bordered compact menu button', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#terminal-btn-commands').click();

    const items = page.locator('#terminal-commands-list .terminal-commands-item');
    await expect(items).toHaveCount(7);
    await expect(items.locator('.terminal-commands-item-label')).toHaveText(
      QUICK_COMMANDS.map(([label]) => label),
    );
    await expect(items.locator('.terminal-commands-item-desc')).toHaveText(
      QUICK_COMMANDS.map(([, description]) => description),
    );

    const appearance = await items.first().evaluate((item) => {
      const style = getComputedStyle(item);
      return {
        borderTopWidth: style.borderTopWidth,
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderTopLeftRadius,
      };
    });

    expect(appearance.borderTopWidth).toBe('1px');
    expect(appearance.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(Number.parseFloat(appearance.borderRadius)).toBeGreaterThan(0);
  });

  test('keeps the final command and hint visible in a compact terminal', async ({ page }) => {
    await openTerminal(page);
    await page.locator('.terminal-window').evaluate((window) => {
      window.style.height = '360px';
      window.style.width = '520px';
    });
    await page.locator('#terminal-btn-commands').click();

    const geometry = await page.locator('#terminal-commands-menu').evaluate((menu) => {
      const list = menu.querySelector('#terminal-commands-list');
      const lastItem = list?.lastElementChild;
      const hint = menu.querySelector('.terminal-commands-hint');
      if (!list || !lastItem || !hint) return null;

      const menuBox = menu.getBoundingClientRect();
      const lastItemBox = lastItem.getBoundingClientRect();
      const hintBox = hint.getBoundingClientRect();
      return {
        listScrolls: list.scrollHeight > list.clientHeight,
        lastItemBottom: lastItemBox.bottom,
        hintBottom: hintBox.bottom,
        menuBottom: menuBox.bottom,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.listScrolls).toBe(false);
    expect(geometry.lastItemBottom).toBeLessThanOrEqual(geometry.menuBottom);
    expect(geometry.hintBottom).toBeLessThanOrEqual(geometry.menuBottom);
  });
});


test.describe('Terminal overflow menu', () => {
  test('renders every section action as a bordered compact menu button', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#terminal-btn-overflow').click();

    const items = page.locator(
      '#terminal-overflow-menu .terminal-menu-section > :is(.terminal-tool-btn, .terminal-signals-item)',
    );
    await expect(items).toHaveCount(17);

    const appearance = await items.evaluateAll((buttons) => buttons.map((button) => {
      const style = getComputedStyle(button);
      return {
        borderTopWidth: style.borderTopWidth,
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderTopLeftRadius,
      };
    }));

    for (const item of appearance) {
      expect(item.borderTopWidth).toBe('1px');
      expect(item.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(Number.parseFloat(item.borderRadius)).toBeGreaterThan(0);
    }
  });
});
