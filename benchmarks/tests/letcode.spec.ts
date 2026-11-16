import { test, expect } from '@playwright/test';
import { LetCodePage } from '../page-objects/LetCodePage.js';

test.describe('Target 4: LetCode Practice Automation', () => {
  test('should manipulate input fields, verify disabled state, and clear values', async ({ page }) => {
    const letcode = new LetCodePage(page);
    await letcode.gotoEdit();

    await letcode.enterFullName('Ada Lovelace');
    await expect(letcode.fullNameInput).toHaveValue('Ada Lovelace');

    await expect(letcode.disabledInput).toBeDisabled();

    await letcode.clearText();
    await expect(letcode.clearInput).toHaveValue('');
  });
});

