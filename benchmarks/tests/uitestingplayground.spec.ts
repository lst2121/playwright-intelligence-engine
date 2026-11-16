import { test, expect } from '@playwright/test';
import { PlaygroundPage } from '../page-objects/PlaygroundPage.js';

test.describe('Target 1: UI Testing Playground Live Automation', () => {
  test('should navigate to Text Input and update button name dynamically', async ({ page }) => {
    const playground = new PlaygroundPage(page);
    await playground.goto();

    await expect(page).toHaveTitle(/UI Test Automation Playground/i);
    await playground.navigateToTextInput();

    const expectedName = 'Playwright Intelligence Verified';
    await playground.updateButtonName(expectedName);

    // Assert that the button text changed to expectedName
    const updatedButton = page.getByRole('button', { name: expectedName });
    await expect(updatedButton).toBeVisible();
    await expect(updatedButton).toHaveText(expectedName);
  });
});

