import { Page, Locator } from '@playwright/test';

export class TheInternetPage {
  readonly page: Page;

  // Pattern 1: Constructor Assignment
  readonly checkbox: Locator;
  readonly removeAddBtn: Locator;
  readonly messageLabel: Locator;
  readonly dynamicInput: Locator;
  readonly enableDisableBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.checkbox = page.locator('#checkbox');
    this.removeAddBtn = page.getByRole('button', { name: 'Remove' });
    this.messageLabel = page.locator('#message');
    this.dynamicInput = page.locator('#input-example input');
    this.enableDisableBtn = page.getByRole('button', { name: 'Enable' });
  }

  async gotoDynamicControls(): Promise<void> {
    await this.page.goto('https://the-internet.herokuapp.com/dynamic_controls', {
      waitUntil: 'domcontentloaded',
    });
  }

  async gotoStatus500(): Promise<void> {
    await this.page.goto('https://the-internet.herokuapp.com/status_codes/500', {
      waitUntil: 'domcontentloaded',
    });
  }

  async removeCheckbox(): Promise<void> {
    await this.removeAddBtn.click();
  }

  async enableInput(): Promise<void> {
    await this.enableDisableBtn.click();
  }
}

