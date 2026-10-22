import { test, expect } from './fixtures.mjs';


const enabled = process.env.E2E_ROUTER_SMOKE === '1';


async function openCoreDialog(page, engine = 'mihomo') {
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/(?:login|setup)(?:[/?#]|$)/);

  const trigger = page.locator('.xk-brand-service-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const action = page.locator(`#xk-mihomo-service-menu [data-xk-svc-core][data-core="${engine}"]`);
  await expect(action).toBeVisible();
  await expect(action).not.toHaveAttribute('aria-disabled', 'true');
  await action.click();
  await expect(page.locator('#core-modal')).toBeVisible();
}


test.describe('Router panel smoke (read-only)', () => {
  test.skip(!enabled, 'Set E2E_ROUTER_SMOKE=1 to target a real router.');

  test('opens Mihomo core management and source selection without applying changes', async ({ page }) => {
    await openCoreDialog(page);

    const source = page.locator('#core-modal [data-core-source][data-core-engine="mihomo"]');
    await expect(source).toBeVisible();
    await expect(source.locator('[data-core-source-version]')).not.toContainText('Проверяем');
    await expect(source.locator('[data-core-source-status]')).not.toContainText('Загружаем состояние');

    await source.getByRole('button', { name: /источник/i }).click();
    const modal = page.locator('#mihomo-core-source-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-core-source-profiles] input[type="radio"]')).not.toHaveCount(0);

    await modal.getByRole('button', { name: 'Закрыть выбор источника' }).click();
    await expect(modal).toBeHidden();
  });
});
