import { test, expect } from '@playwright/test';
import { ControlledAppPage } from '../pages/controlled-app.page.js';

test.describe('Controlled App Baseline & Defect Invariant Verification', () => {
  let appPage: ControlledAppPage;

  test.beforeEach(async ({ page }) => {
    appPage = new ControlledAppPage(page);
  });

  test('LOGIN-01: User Login Verification', async ({ page }) => {
    await appPage.gotoLogin();
    await appPage.login('admin@example.com', 'admin123');
    await expect(page.locator('#login-status')).toContainText('Login Successful');
  });

  test('CHECKOUT-01: Order Total and Placement Verification', async ({ page }) => {
    await appPage.gotoCheckout();
    await expect(appPage.orderTotal).toHaveText('$99.00');
    await appPage.checkout('4532015099881234', '123 Test St, Silicon Valley, CA');
    await expect(page.locator('#checkout-result')).toContainText('Order Confirmed');
    await expect(page.locator('#checkout-result')).toContainText('Total: $99.00');
  });

  test('DEFECT-01: Invalid Card Must Be Rejected', async ({ page }) => {
    await appPage.gotoCheckout();
    await appPage.checkout('000000000000', '123 Test St');
    await expect(page.locator('#checkout-result')).toContainText('Checkout Failed');
  });
});

