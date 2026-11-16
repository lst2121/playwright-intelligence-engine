import { test, expect } from '@playwright/test';
import { OrangeHRMPage } from '../page-objects/OrangeHRMPage.js';

test.describe('Target 5: OrangeHRM Enterprise Portal Automation', () => {
  test('should authenticate and land on Enterprise Dashboard', async ({ page }) => {
    const orange = new OrangeHRMPage(page);
    await orange.goto();

    await orange.login('Admin', 'admin123');

    // Verify successful enterprise authentication
    await expect(orange.dashboardHeading).toBeVisible({ timeout: 15000 });
    await expect(orange.userDropdown).toBeVisible();
  });
});

