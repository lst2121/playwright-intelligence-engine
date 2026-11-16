import { Page, Locator } from '@playwright/test';

export class PlaygroundPage {
  readonly page: Page;

  // Pattern 1: Constructor Assignment
  readonly dynamicIdLink: Locator;
  readonly textInputLink: Locator;
  readonly classAttributeLink: Locator;
  readonly primaryButton: Locator;
  readonly newButtonNameInput: Locator;
  readonly updatingButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dynamicIdLink = page.getByRole('link', { name: 'Dynamic ID' });
    this.textInputLink = page.getByRole('link', { name: 'Text Input' });
    this.classAttributeLink = page.getByRole('link', { name: 'Class Attribute' });
    this.primaryButton = page.getByRole('button', { name: 'Button with Dynamic ID' });
    this.newButtonNameInput = page.getByPlaceholder('MyButton');
    this.updatingButton = page.getByRole('button', { name: "Button That Should Change it's Name Based on Input Value" });
  }

  async goto(): Promise<void> {
    await this.page.goto('http://uitestingplayground.com/', { waitUntil: 'domcontentloaded' });
  }

  async navigateToTextInput(): Promise<void> {
    await this.textInputLink.click();
    await this.page.waitForURL('**/textinput');
  }

  async updateButtonName(newName: string): Promise<void> {
    await this.newButtonNameInput.fill(newName);
    await this.updatingButton.click();
  }
}
