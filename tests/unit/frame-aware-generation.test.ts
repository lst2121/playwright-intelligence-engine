import { describe, it, expect } from 'vitest';
import { renderLocator, planArchitecture } from '../../src/generator/architecture-generator.js';
import type { GeneratedStep } from '../../src/generator/test-generator.js';
import type { AppModel } from '../../src/perception/app-model.js';

describe('Frame-aware Generation & Perception Layer (Work Package A)', () => {
  it('renders a framed element with this.page.frameLocator(...)', () => {
    const step: GeneratedStep = {
      action: 'click',
      role: 'button',
      name: 'Submit Payment',
      frame: 'iframe[title="Payment"]',
    };

    const rendered = renderLocator(step, 'getByRole');
    expect(rendered).toBe("this.page.frameLocator('iframe[title=\"Payment\"]').getByRole('button', { name: 'Submit Payment' })");
  });

  it('renders a non-framed element without frameLocator', () => {
    const step: GeneratedStep = {
      action: 'click',
      role: 'button',
      name: 'Submit Form',
    };

    const rendered = renderLocator(step, 'getByRole');
    expect(rendered).toBe("this.page.getByRole('button', { name: 'Submit Form' })");
  });

  it('generates a Page Object with frameLocator when step has frameSelector', () => {
    const plan = planArchitecture({
      featureName: 'CardCheckout',
      mode: 'greenfield',
      steps: [
        { action: 'navigate' },
        {
          action: 'fill',
          role: 'textbox',
          name: 'Card Number',
          frame: 'iframe#card-frame',
        },
        {
          action: 'click',
          role: 'button',
          name: 'Pay Now',
          frame: 'iframe#card-frame',
        },
      ],
    });

    const pageFile = plan.files.find((f) => f.relativePath.endsWith('CardCheckoutPage.ts'));
    expect(pageFile).toBeDefined();
    expect(pageFile!.content).toContain("this.cardNumberInput = this.page.frameLocator('iframe#card-frame').getByRole('textbox', { name: 'Card Number' });");
    expect(pageFile!.content).toContain("this.payNowButton = this.page.frameLocator('iframe#card-frame').getByRole('button', { name: 'Pay Now' });");
  });

  it('auto-discovers frameSelector from AppModel during architecture planning', () => {
    const appModel: AppModel = {
      version: '1',
      baseUrl: 'http://localhost:3000',
      fingerprint: 'test-fingerprint',
      capturedAt: new Date().toISOString(),
      routes: [
        {
          route: '/checkout',
          elements: [
            {
              tag: 'input',
              role: 'textbox',
              accessibleName: 'Security Code',
              frameSelector: 'iframe[name="cvv-frame"]',
              count: 1,
              visible: true,
            },
          ],
        },
      ],
    };

    const plan = planArchitecture({
      featureName: 'SecurityVerification',
      mode: 'greenfield',
      appModel,
      steps: [
        { action: 'navigate' },
        { action: 'fill', role: 'textbox', name: 'Security Code' },
      ],
    });

    const pageFile = plan.files.find((f) => f.relativePath.endsWith('SecurityVerificationPage.ts'));
    expect(pageFile).toBeDefined();
    expect(pageFile!.content).toContain("this.securityCodeInput = this.page.frameLocator('iframe[name=\"cvv-frame\"]').getByRole('textbox', { name: 'Security Code' });");
  });
});

