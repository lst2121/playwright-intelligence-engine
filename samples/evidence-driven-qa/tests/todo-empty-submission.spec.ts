import { test, expect } from '@playwright/test';
import { TodoAppPage } from './pages/TodoAppPage.js';

test.describe('Todo Task Management - empty submission (REQ-2)', () => {
  test('submitting an empty title does not add a task @id:sc-req-2-validation @req:REQ-2', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    // Seed one valid task so we can prove the empty submission is a no-op
    // relative to a non-empty baseline (act-3 domAfterSummary: "0 of 1").
    const seed = 'PIE Verify sc-req-2-hap';
    await app.addTask(seed);
    await expect(app.taskByTitle(seed)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 1');

    await app.submitEmpty();

    // act-4 domDiff is empty: no new task, counters unchanged.
    await expect(app.progressIndicator).toHaveText('0 of 1');
    await expect(app.taskByTitle(seed)).toBeVisible();
    await expect(app.newTaskInput).toHaveValue('');
  });

  test('empty submission leaves state intact across reload @id:sc-req-2-persistence @req:REQ-2', async ({ page }) => {
    const app = new TodoAppPage(page);
    await app.goto();

    const seed = 'PIE Verify sc-req-2-hap';
    await app.addTask(seed);
    await expect(app.progressIndicator).toHaveText('0 of 1');

    await app.submitEmpty();
    await expect(app.progressIndicator).toHaveText('0 of 1');

    await app.reload();

    // act-5 domAfterSummary matches domBeforeSummary: no blank task persisted.
    await expect(app.taskByTitle(seed)).toBeVisible();
    await expect(app.progressIndicator).toHaveText('0 of 1');
  });
});
