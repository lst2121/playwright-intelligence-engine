import { Page, Locator } from '@playwright/test';

export class SauceDemoPage {
  readonly page: Page;

  // Pattern 1: Constructor Assignment
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly inventoryList: Locator;
  readonly addToCartBackpackBtn: Locator;
  readonly shoppingCartBadge: Locator;
  readonly cartLink: Locator;
  readonly checkoutBtn: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly postalCodeInput: Locator;
  readonly continueBtn: Locator;
  readonly finishBtn: Locator;
  readonly completeHeader: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator('[data-test="username"]');
    this.passwordInput = page.locator('[data-test="password"]');
    this.loginButton = page.locator('[data-test="login-button"]');
    this.inventoryList = page.locator('.inventory_list');
    this.addToCartBackpackBtn = page.locator('[data-test="add-to-cart-sauce-labs-backpack"]');
    this.shoppingCartBadge = page.locator('.shopping_cart_badge');
    this.cartLink = page.locator('.shopping_cart_link');
    this.checkoutBtn = page.locator('[data-test="checkout"]');
    this.firstNameInput = page.locator('[data-test="firstName"]');
    this.lastNameInput = page.locator('[data-test="lastName"]');
    this.postalCodeInput = page.locator('[data-test="postalCode"]');
    this.continueBtn = page.locator('[data-test="continue"]');
    this.finishBtn = page.locator('[data-test="finish"]');
    this.completeHeader = page.locator('.complete-header');
  }

  async goto(): Promise<void> {
    await this.page.goto('https://www.saucedemo.com/', { waitUntil: 'domcontentloaded' });
  }

  async login(username = 'standard_user', password = 'secret_sauce'): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async addBackpackToCart(): Promise<void> {
    await this.addToCartBackpackBtn.click();
  }

  async checkout(first = 'John', last = 'Doe', zip = '10001'): Promise<void> {
    await this.cartLink.click();
    await this.checkoutBtn.click();
    await this.firstNameInput.fill(first);
    await this.lastNameInput.fill(last);
    await this.postalCodeInput.fill(zip);
    await this.continueBtn.click();
    await this.finishBtn.click();
  }
}

