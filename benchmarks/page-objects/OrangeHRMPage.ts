import { Page, Locator } from '@playwright/test';

export class OrangeHRMPage {
  readonly page: Page;

  // Pattern 1: Constructor Assignment
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginBtn: Locator;
  readonly dashboardHeading: Locator;
  readonly userDropdown: Locator;
  readonly adminMenuLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.getByPlaceholder('Username');
    this.passwordInput = page.getByPlaceholder('Password');
    this.loginBtn = page.getByRole('button', { name: 'Login' });
    this.dashboardHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.userDropdown = page.locator('.oxd-userdropdown-tab');
    this.adminMenuLink = page.getByRole('link', { name: 'Admin' });
  }

  async goto(): Promise<void> {
    await this.page.goto('https://opensource-demo.orangehrmlive.com/', {
      waitUntil: 'networkidle',
    });
  }

  async login(user = 'Admin', pass = 'admin123'): Promise<void> {
    await this.usernameInput.fill(user);
    await this.passwordInput.fill(pass);
    await this.loginBtn.click();
  }

  async navigateToAdmin(): Promise<void> {
    await this.adminMenuLink.click();
  }
}

