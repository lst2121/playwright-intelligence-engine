import { test, expect } from '@playwright/test';

test('flaky sample with sleep', async ({ page }) => {
  await page.goto('/items');
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#success-message')).toBeVisible();
});
