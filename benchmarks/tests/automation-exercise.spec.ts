import { test, expect } from '@playwright/test';
import { AutomationExercisePage } from '../page-objects/AutomationExercisePage.js';

test.describe('Target 6: Automation Exercise E-Commerce Automation', () => {
  test('should search for products and verify search results', async ({ page }) => {
    const autoEx = new AutomationExercisePage(page);
    await autoEx.searchProduct('tshirt');

    await expect(autoEx.searchedProductsHeading).toBeVisible();
    const count = await autoEx.productCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

