import { test, expect, selectPanelView } from './fixtures.mjs';

// "Terminal here" in the file manager opens the terminal module. Without that
// module the controls would open nothing, so the file manager leaves them out.
const PROFILE = String(process.env.XKEEN_E2E_MODULE_PROFILE || 'full').toLowerCase();
const EXPECTS_TERMINAL = { full: true, 'files-no-terminal': false };

test.skip(!(PROFILE in EXPECTS_TERMINAL), `profile ${PROFILE} has no file manager`);

test('file manager offers the terminal only when the terminal module is installed', async ({ page }) => {
  const expected = EXPECTS_TERMINAL[PROFILE];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await selectPanelView(page, 'files');
  const rows = page.locator('#fm-root [data-name]');
  await expect(rows.first()).toBeVisible();

  const toolbarButton = page.locator('#fm-terminal-here-btn');
  if (expected) await expect(toolbarButton).toBeVisible();
  else await expect(toolbarButton).toBeHidden();

  await rows.first().click({ button: 'right' });
  const menuItem = page.getByRole('button', { name: /^Терминал (здесь|в папке)$/ });
  const otherItem = page.getByRole('button', { name: /^Свойства/ });
  await expect(otherItem).toBeVisible();
  await expect(menuItem).toHaveCount(expected ? 1 : 0);
});
