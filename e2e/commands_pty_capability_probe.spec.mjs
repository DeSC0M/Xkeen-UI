import { test, expect, selectPanelView } from './fixtures.mjs';
import { PTY_CAPABILITIES, mockPty } from './pty_terminal_mock.mjs';


// The command buttons run their command inside the PTY terminal. Whether the
// router has PTY is learned from /api/capabilities, and on a remote router that
// answer may come late or not at all. These tests pin what the panel does then.

async function mockCapabilities(page, link) {
  await page.route('**/api/capabilities', async (route) => {
    if (link.down) {
      await route.abort('connectionfailed');
      return;
    }
    if (link.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, link.delayMs));
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PTY_CAPABILITIES),
      });
    } catch (error) {
      // The page gave up on this request while it was being held back.
    }
  });
}


async function openCommands(page) {
  await page.goto('/');
  await selectPanelView(page, 'commands');
  await expect(page.locator('#view-commands')).toBeVisible();
}


function commandRow(page) {
  return page.locator('.command-item[data-flag="-i"]');
}


test.describe('Commands: PTY capability probe on a slow link', () => {
  test('a late capabilities answer still runs the command in PTY', async ({ page }) => {
    const link = { down: false, delayMs: 3000 };
    await mockCapabilities(page, link);
    const inputs = await mockPty(page);

    await openCommands(page);
    await commandRow(page).locator('.command-item-action').click();

    await expect.poll(() => inputs.join(''), { timeout: 20_000 }).toContain('xkeen -i\r');
    await expect(page.locator('#toast-container .toast')).toHaveCount(0);
  });

  test('a failed probe is not remembered as "no PTY"', async ({ page }) => {
    test.setTimeout(90_000);
    const link = { down: true, delayMs: 0 };
    await mockCapabilities(page, link);
    const inputs = await mockPty(page);

    await openCommands(page);
    const row = commandRow(page);
    // The row is not busy before the press is handled either, and on a loaded
    // machine the handling starts late. So the press is over only when the row
    // has been seen busy and is busy no more.
    await row.evaluate((element) => {
      window.__xkRowWasBusy = false;
      new MutationObserver(() => {
        if (element.getAttribute('aria-busy') === 'true') window.__xkRowWasBusy = true;
      }).observe(element, { attributes: true, attributeFilter: ['aria-busy'] });
    });
    await row.locator('.command-item-action').click();
    await expect.poll(() => page.evaluate(() => window.__xkRowWasBusy), { timeout: 25_000 }).toBe(true);
    await expect(row).not.toHaveAttribute('aria-busy', 'true', { timeout: 25_000 });
    expect(inputs.join('')).toBe('');

    // The link is back: the very next press must reach PTY.
    link.down = false;
    const close = page.locator('#terminal-btn-close');
    if (await close.isVisible()) await close.click();
    await expect(page.locator('#terminal-overlay')).toBeHidden();

    await row.locator('.command-item-action').click();
    await expect.poll(() => inputs.join(''), { timeout: 20_000 }).toContain('xkeen -i\r');
  });

  test('a press that lands before the command list has loaded still runs the command', async ({ page }) => {
    const link = { down: false, delayMs: 0 };
    await mockCapabilities(page, link);
    const inputs = await mockPty(page);

    // Hold the command list module back, as a slow link to the router does.
    // The press is then caught by the lazy-feature guard and replayed later.
    await page.route(/\/commands_list[-.][^/]*\.js(\?|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try { await route.continue(); } catch (error) {}
    });

    await openCommands(page);
    await commandRow(page).locator('.command-item-action').click();

    await expect.poll(() => inputs.join(''), { timeout: 20_000 }).toContain('xkeen -i\r');
  });

  test('a refused WebSocket is reported as a connection problem', async ({ page }) => {
    test.setTimeout(45_000);
    const link = { down: false, delayMs: 0 };
    await mockCapabilities(page, link);
    await mockPty(page, { refuse: true });

    await openCommands(page);
    await commandRow(page).locator('.command-item-action').click();

    const toast = page.locator('#toast-container .toast');
    await expect(toast).toContainText('WebSocket-соединение с роутером не устанавливается', { timeout: 25_000 });
    await expect(toast).toContainText('Команда не выполнена');
  });
});
