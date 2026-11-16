import { Page, Locator } from '@playwright/test';

export class LetCodePage {
  readonly page: Page;

  // Pattern 1: Constructor Assignment
  readonly fullNameInput: Locator;
  readonly appendInput: Locator;
  readonly getMeInput: Locator;
  readonly clearInput: Locator;
  readonly disabledInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fullNameInput = page.locator('#fullName');
    this.appendInput = page.locator('#join');
    this.getMeInput = page.locator('#getMe');
    this.clearInput = page.locator('#clearMe');
    this.disabledInput = page.locator('#noEdit');
  }

  async gotoEdit(): Promise<void> {
    await this.page.goto('https://letcode.in/edit', { waitUntil: 'domcontentloaded' });
  }

  async enterFullName(name: string): Promise<void> {
    await this.fullNameInput.fill(name);
  }

  async appendText(text: string): Promise<void> {
    await this.appendInput.press('End');
    await this.appendInput.pressSequentially(text);
  }

  async clearText(): Promise<void> {
    await this.clearInput.clear();
  }
}

