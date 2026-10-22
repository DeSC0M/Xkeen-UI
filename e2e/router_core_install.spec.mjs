import { test, expect } from './fixtures.mjs';


const enabled = process.env.E2E_ROUTER_DESTRUCTIVE === '1';


async function openMihomoCoreDialog(page) {
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/(?:login|setup)(?:[/?#]|$)/);

  const trigger = page.locator('.xk-brand-service-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const coreAction = page.locator('#xk-mihomo-service-menu [data-xk-svc-core][data-core="mihomo"]');
  await expect(coreAction).toBeVisible();
  await expect(coreAction).not.toHaveAttribute('aria-disabled', 'true');
  await coreAction.click();
  await expect(page.locator('#core-modal')).toBeVisible();
}


test.describe('Router Mihomo core reinstall (destructive)', () => {
  test.skip(!enabled, 'Set E2E_ROUTER_DESTRUCTIVE=1 only for a disposable lab router.');

  test('finishes without a stale spinner or install tooltip', async ({ page }) => {
    test.setTimeout(180_000);
    await openMihomoCoreDialog(page);

    const source = page.locator('#core-modal [data-core-source][data-core-engine="mihomo"]');
    const prepare = source.locator('[data-core-source-action="prepare"]');
    await expect(prepare).toBeEnabled();
    await prepare.click();

    const modal = page.locator('#mihomo-core-install-modal');
    const apply = modal.locator('[data-core-source-action="apply"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-core-install-details]')).not.toBeEmpty();
    await apply.click();

    await expect(modal.locator('[data-core-install-progress]')).toBeVisible();
    await expect(apply).toHaveText('Закрыть', { timeout: 150_000 });
    await expect(modal.locator('[data-core-install-percent]')).toHaveText('100%');
    await expect(modal.locator('[data-core-install-phase]')).toHaveText('Установка завершена');
    await expect(apply).toBeEnabled();
    await expect(apply).not.toHaveClass(/is-working/);
    await expect(apply).not.toHaveAttribute('aria-busy');
    await expect(apply).toHaveAttribute('data-tooltip', 'Закрыть окно установки');

    await apply.click();
    await expect(modal).toBeHidden();
  });
});
