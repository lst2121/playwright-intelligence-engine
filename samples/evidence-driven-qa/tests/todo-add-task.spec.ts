import { test, expect } from '@playwright/test';
import { TodoAppPage } from './pages/TodoAppPage.js';

test.describe('Todo Task Management - add task (REQ-1)', () => {
  test('adds a new task and increments the created-task counter @id:sc-req-1-happy-path @req:REQ-1', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    // Baseline: empty list per act-1 domBeforeSummary ("0 of 0").
    await expect(app.progressIndicator).toHaveText('0 of 0');

    const title = 'PIE Verify sc-req-1-hap';
    await app.addTask(title);

    // act-1 domAfterSummary: "Created Task | 1", "Completed Tasks | 0 of 1", task title visible.
    await expect(app.taskByTitle(title)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 1');
    await expect(app.newTaskInput).toHaveValue('');
  });

  test('added task survives a page reload @id:sc-req-1-persistence @req:REQ-1', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    const title = 'PIE Verify sc-req-1-hap';
    await app.addTask(title);
    await expect(app.taskByTitle(title)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 1');

    await app.reload();

    // act-2 domAfterSummary matches domBeforeSummary: state preserved across reload.
    await expect(app.taskByTitle(title)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 1');
  });
});
