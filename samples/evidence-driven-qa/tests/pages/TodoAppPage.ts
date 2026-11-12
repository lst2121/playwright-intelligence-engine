import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Page object for the Todo Task Management app.
 *
 * Locators are grounded strictly in verified evidence:
 *  - loc-1: textbox with placeholder "Add a New Task"
 *  - loc-2: button with accessible name "Create"
 *  - act-1..act-8: DOM summaries expose counters "Created Task", "Completed Tasks"
 *    and a "N of M" progress indicator, plus the created task titles as text.
 */
export class TodoAppPage {
  readonly page: Page;
  readonly newTaskInput: Locator;
  readonly createButton: Locator;
  readonly createdTaskCounter: Locator;
  readonly completedTasksCounter: Locator;
  readonly progressIndicator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.newTaskInput = page.getByPlaceholder('Add a New Task');
    this.createButton = page.getByRole('button', { name: 'Create' });
    // Counter labels are evidenced in every DOM summary (e.g. "Created Task | 1",
    // "Completed Tasks | 0 of 1"). We anchor on the label text and read the
    // adjacent numeric value from the same container.
    this.createdTaskCounter = page.getByText('Created Task', { exact: true });
    this.completedTasksCounter = page.getByText('Completed Tasks', { exact: true });
    this.progressIndicator = page.getByText(/^\d+ of \d+$/);
  }

  async goto(): Promise<void> {
    await this.page.goto('/todo-app/');
    await expect(this.newTaskInput).toBeVisible();
    await expect(this.createButton).toBeVisible();
  }

  async addTask(title: string): Promise<void> {
    await this.newTaskInput.fill(title);
    await this.createButton.click();
  }

  async submitEmpty(): Promise<void> {
    await this.newTaskInput.fill('');
    await this.createButton.click();
  }

  taskByTitle(title: string): Locator {
    return this.page.getByText(title, { exact: true });
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await expect(this.newTaskInput).toBeVisible();
  }
}
