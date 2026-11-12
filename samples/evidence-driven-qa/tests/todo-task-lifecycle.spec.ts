import { test, expect } from '@playwright/test';
import { TodoAppPage } from './pages/TodoAppPage.js';

test.describe('Todo Task Management - task lifecycle (REQ-3)', () => {
  test('adding a task updates the created-task counter @id:sc-req-3-happy-path @req:REQ-3', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    const first = 'PIE Verify sc-req-3-hap';
    await app.addTask(first);
    await expect(app.taskByTitle(first)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 1');

    const second = 'PIE Verify sc-req-3-sta';
    await app.addTask(second);

    // act-6/act-8 domAfterSummary: "Created Task | 2", "Completed Tasks | 0 of 2".
    await expect(app.taskByTitle(first)).toBeVisible();
    await expect(app.taskByTitle(second)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 2');
  });

  test('tasks persist across reload @id:sc-req-3-persistence @req:REQ-3', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    const first = 'PIE Verify sc-req-3-hap';
    const second = 'PIE Verify sc-req-3-sta';
    await app.addTask(first);
    await app.addTask(second);
    await expect(app.progressIndicator).toHaveText('0 of 2');

    await app.reload();

    // act-7 domAfterSummary matches domBeforeSummary: both tasks preserved.
    await expect(app.taskByTitle(first)).toBeVisible();
    await expect(app.taskByTitle(second)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 2');
  });

  test('completed-task counter reflects the current task set @id:sc-req-3-state-transition @req:REQ-3', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    const first = 'PIE Verify sc-req-3-hap';
    await app.addTask(first);
    await expect(app.progressIndicator).toHaveText('0 of 1');

    const second = 'PIE Verify sc-req-3-sta';
    await app.addTask(second);

    // act-8 domAfterSummary: "Created Task | 2", "Completed Tasks | 0 of 2".
    // The completed counter must stay consistent with the created count.
    await expect(app.progressIndicator).toHaveText('0 of 2');
    await expect(app.completedTasksCounter).toBeVisible();
    await expect(app.createdTaskCounter).toBeVisible();
  });
});
