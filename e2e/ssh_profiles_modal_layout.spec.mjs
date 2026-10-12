import { test, expect } from './fixtures.mjs';


test.describe('SSH profiles modal', () => {
  test('keeps action icons and labels on one centered line', async ({ page }) => {
    await page.goto('/');

    const modal = page.locator('#ssh-modal');
    await modal.evaluate((element) => element.classList.remove('hidden'));
    await expect(modal).toBeVisible();

    for (const buttonId of [
      'ssh-add-btn',
      'ssh-delete-selected-btn',
      'ssh-export-btn',
      'ssh-import-btn',
      'ssh-copy-preview-btn',
      'ssh-run-preview-btn',
    ]) {
      const geometry = await page.locator(`#${buttonId}`).evaluate((button) => {
        const icon = button.querySelector('.xk-action-icon');
        const label = button.querySelector('.xk-action-label');
        if (!icon || !label) return null;

        const iconBox = icon.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          display: style.display,
          iconCenterY: iconBox.top + iconBox.height / 2,
          labelCenterY: labelBox.top + labelBox.height / 2,
          iconRight: iconBox.right,
          labelLeft: labelBox.left,
        };
      });

      expect(geometry).not.toBeNull();
      expect(['flex', 'inline-flex']).toContain(geometry.display);
      expect(Math.abs(geometry.iconCenterY - geometry.labelCenterY)).toBeLessThanOrEqual(1);
      expect(geometry.labelLeft).toBeGreaterThan(geometry.iconRight);
    }
  });
});
