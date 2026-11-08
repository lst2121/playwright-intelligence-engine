import { describe, expect, it } from 'vitest';
import { NamePlanner, NamingLinter, type GeneratedStep } from '../../src/index.js';

describe('Naming Matrix Suite — Semantic Identifiers, Zero Index Names, Zero Duplicates', () => {
  const matrixCases: Array<{
    action: GeneratedStep['action'];
    role?: string;
    name: string;
    expectedProperty: string;
    expectedMethod: string;
  }> = [
    { action: 'fill', role: 'textbox', name: 'Email Address', expectedProperty: 'emailAddressInput', expectedMethod: 'fillEmailAddress' },
    { action: 'fill', role: 'searchbox', name: 'Product Search', expectedProperty: 'productSearchInput', expectedMethod: 'fillProductSearch' },
    { action: 'fill', role: 'textbox', name: 'Password', expectedProperty: 'passwordInput', expectedMethod: 'fillPassword' },
    { action: 'click', role: 'button', name: 'Sign in to Account', expectedProperty: 'signInToAccountButton', expectedMethod: 'signIn' },
    { action: 'click', role: 'button', name: 'Submit Application', expectedProperty: 'submitApplicationButton', expectedMethod: 'submitApplication' },
    { action: 'click', role: 'button', name: 'Register Now', expectedProperty: 'registerNowButton', expectedMethod: 'signUp' },
    { action: 'click', role: 'link', name: 'Pricing Plans', expectedProperty: 'pricingPlansLink', expectedMethod: 'openPricingPlans' },
    { action: 'click', role: 'checkbox', name: 'Remember My Preference', expectedProperty: 'rememberMyPreferenceCheckbox', expectedMethod: 'clickRememberMyPreference' },
    { action: 'click', role: 'combobox', name: 'Billing Country', expectedProperty: 'billingCountrySelect', expectedMethod: 'clickBillingCountry' },
    { action: 'click', role: 'tab', name: 'Security Settings', expectedProperty: 'securitySettingsTab', expectedMethod: 'openSecuritySettings' },
    { action: 'click', role: 'radio', name: 'Express Delivery', expectedProperty: 'expressDeliveryRadio', expectedMethod: 'clickExpressDelivery' },
    { action: 'assert-visible', role: 'heading', name: 'User Dashboard', expectedProperty: 'userDashboardHeading', expectedMethod: 'expectUserDashboardVisible' },
    { action: 'assert-text', role: 'status', name: 'Order Placed Confirmation', expectedProperty: 'orderPlacedConfirmationStatus', expectedMethod: 'expectOrderPlacedConfirmationText' },
  ];

  it.each(matrixCases)('matrix case: $action x $role ($name)', ({ action, role, name, expectedProperty, expectedMethod }) => {
    const steps: GeneratedStep[] = [{ action, role, name }];
    const plan = NamePlanner.planNames('TestFeature', steps);

    expect(plan.symbols).toHaveLength(1);
    const sym = plan.symbols[0]!;
    expect(sym.property).toBe(expectedProperty);
    expect(sym.method).toBe(expectedMethod);

    const report = NamingLinter.lint(plan);
    expect(report.passed).toBe(true);
    expect(report.indexDerivedIdentifierCount).toBe(0);
    expect(report.duplicateSymbolCount).toBe(0);
    expect(report.namingConformanceRate).toBe(1.0);
    expect(report.semanticNameCoverage).toBe(1.0);
  });

  it('disambiguates identical button names without using bare index numbers', () => {
    const steps: GeneratedStep[] = [
      { action: 'click', role: 'button', name: 'Submit' },
      { action: 'click', role: 'button', name: 'Submit' },
      { action: 'click', role: 'button', name: 'Submit' },
    ];
    const plan = NamePlanner.planNames('OrderForm', steps);
    expect(plan.symbols).toHaveLength(3);

    const properties = plan.symbols.map((s) => s.property);
    expect(new Set(properties).size).toBe(3);
    for (const prop of properties) {
      expect(prop).not.toMatch(/\d+/);
    }

    const report = NamingLinter.lint(plan);
    expect(report.passed).toBe(true);
    expect(report.duplicateSymbolCount).toBe(0);
    expect(report.indexDerivedIdentifierCount).toBe(0);
  });

  it('sanitizes and disambiguates reserved words cleanly', () => {
    const steps: GeneratedStep[] = [
      { action: 'fill', role: 'textbox', name: 'class' },
      { action: 'click', role: 'button', name: 'delete' },
      { action: 'click', role: 'link', name: 'goto' },
    ];
    const plan = NamePlanner.planNames('Administration', steps);
    const report = NamingLinter.lint(plan);

    expect(report.passed).toBe(true);
    expect(report.indexDerivedIdentifierCount).toBe(0);
    for (const sym of plan.symbols) {
      expect(['class', 'delete', 'goto', 'page', 'locator']).not.toContain(sym.property.toLowerCase());
    }
  });

  it('linter catches illegal index-derived names and duplicates when injected artificially', () => {
    const illegalPlan = {
      planVersion: '1' as const,
      pageClassName: 'BadPage',
      pageVariable: 'badPage',
      symbols: [
        {
          ref: 'step-1',
          property: 'actionButton1',
          method: 'click1',
          verb: 'click',
          confidence: 0.5,
          source: 'heuristic' as const,
          assumptions: [],
        },
        {
          ref: 'step-2',
          property: 'actionButton1',
          method: 'fill2',
          verb: 'fill',
          confidence: 0.5,
          source: 'heuristic' as const,
          assumptions: [],
        },
      ],
      assumptions: [],
    };
    const report = NamingLinter.lint(illegalPlan);
    expect(report.passed).toBe(false);
    expect(report.indexDerivedIdentifierCount).toBeGreaterThanOrEqual(3);
    expect(report.duplicateSymbolCount).toBeGreaterThanOrEqual(1);
  });
});

