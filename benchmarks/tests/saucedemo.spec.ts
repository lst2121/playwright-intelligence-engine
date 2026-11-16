import { test, expect } from '@playwright/test';
import { SauceDemoPage } from '../page-objects/SauceDemoPage.js';

test.describe('Target 2: SauceDemo E-Commerce End-to-End Automation', () => {
  test('should successfully login, add backpack to cart, and complete checkout', async ({ page }) => {
    const sauce = new SauceDemoPage(page);
    await sauce.goto();

    await sauce.login('standard_user', 'secret_sauce');
    await expect(sauce.inventoryList).toBeVisible();

    await sauce.addBackpackToCart();
    await expect(sauce.shoppingCartBadge).toHaveText('1');

    await sauce.checkout('Jane', 'SDET', '90210');
    await expect(sauce.completeHeader).toBeVisible();
    await expect(sauce.completeHeader).toHaveText(/thank you for your order/i);
  });
});

