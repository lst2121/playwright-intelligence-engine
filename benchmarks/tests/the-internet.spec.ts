import { test, expect } from '@playwright/test';
import { TheInternetPage } from '../page-objects/TheInternetPage.js';

test.describe('Target 3: The Internet Dynamic Controls Automation', () => {
  test('should asynchronously remove checkbox and enable dynamic input', async ({ page }) => {
    const internet = new TheInternetPage(page);
    await internet.gotoDynamicControls();

    await expect(internet.checkbox).toBeVisible();
    await internet.removeCheckbox();

    // Async DOM wait for message
    await expect(internet.messageLabel).toHaveText("It's gone!", { timeout: 10000 });
    await expect(internet.checkbox).toBeHidden();

    // Enable disabled text input
    await expect(internet.dynamicInput).toBeDisabled();
    await internet.enableInput();
    await expect(internet.messageLabel).toHaveText("It's enabled!", { timeout: 10000 });
    await expect(internet.dynamicInput).toBeEnabled();
  });
});

