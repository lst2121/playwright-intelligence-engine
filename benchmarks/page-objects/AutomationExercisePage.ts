import { Page, Locator } from '@playwright/test';

export class AutomationExercisePage {
  readonly page: Page;

  // Pattern 1: Constructor Assignment
  readonly homeLink: Locator;
  readonly productsLink: Locator;
  readonly searchProductInput: Locator;
  readonly submitSearchBtn: Locator;
  readonly searchedProductsHeading: Locator;
  readonly productCards: Locator;
  readonly subscriptionEmailInput: Locator;
  readonly subscribeBtn: Locator;
  readonly subscriptionSuccessAlert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.homeLink = page.getByRole('link', { name: 'Home' });
    this.productsLink = page.getByRole('link', { name: ' Products' });
    this.searchProductInput = page.locator('#search_product');
    this.submitSearchBtn = page.locator('#submit_search');
    this.searchedProductsHeading = page.getByRole('heading', { name: 'Searched Products' });
    this.productCards = page.locator('.product-image-wrapper');
    this.subscriptionEmailInput = page.locator('#susbscribe_email');
    this.subscribeBtn = page.locator('#subscribe');
    this.subscriptionSuccessAlert = page.locator('.alert-success');
  }

  async goto(): Promise<void> {
    await this.page.goto('https://automationexercise.com/', {
      waitUntil: 'domcontentloaded',
    });
  }

  async searchProduct(query: string): Promise<void> {
    await this.page.goto('https://automationexercise.com/products', {
      waitUntil: 'domcontentloaded',
    });
    await this.searchProductInput.fill(query);
    await this.submitSearchBtn.click();
  }

  async subscribe(email: string): Promise<void> {
    await this.subscriptionEmailInput.scrollIntoViewIfNeeded();
    await this.subscriptionEmailInput.fill(email);
    await this.subscribeBtn.click();
  }
}

