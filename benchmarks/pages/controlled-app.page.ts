import { Page, Locator } from '@playwright/test';

export class ControlledAppPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loginStatus: Locator;

  readonly cardNumberInput: Locator;
  readonly addressInput: Locator;
  readonly placeOrderButton: Locator;
  readonly orderTotal: Locator;
  readonly checkoutResult: Locator;

  constructor(page: Page) {
    this.page = page;
    // Pattern 1: Constructor assignments for enterprise POM
    this.usernameInput = page.getByRole('textbox', { name: 'Email Address' });
    this.passwordInput = page.locator('#password');
    this.loginButton = page.getByRole('button', { name: 'Sign In' });
    this.loginStatus = page.locator('#login-status');

    this.cardNumberInput = page.locator('#card');
    this.addressInput = page.locator('#address');
    this.placeOrderButton = page.getByRole('button', { name: 'Place Order' });
    this.orderTotal = page.locator('#order-total');
    this.checkoutResult = page.locator('#checkout-result');
  }

  async gotoLogin(baseUrl = 'http://localhost:4173') {
    await this.page.goto(`${baseUrl}/login`);
  }

  async gotoCheckout(baseUrl = 'http://localhost:4173') {
    await this.page.goto(`${baseUrl}/checkout`);
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async checkout(cardNumber: string, address: string) {
    await this.cardNumberInput.fill(cardNumber);
    await this.addressInput.fill(address);
    await this.placeOrderButton.click();
  }
}

