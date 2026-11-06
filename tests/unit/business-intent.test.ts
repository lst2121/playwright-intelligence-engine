import { describe, expect, it } from 'vitest';
import {
  AssertionPreservationOracle,
  BusinessOracleRegistry,
  ExecutionOracle,
  evaluateBuiltInBusinessOracles,
  extractBusinessIntent,
} from '../../src/intelligence/business-intent.js';

describe('business intent and verification oracles', () => {
  it('extracts conservative business intent from title and test evidence', () => {
    const intent = extractBusinessIntent({
      id: 'checkout-001',
      title: 'Customer can complete checkout payment',
      sourcePath: 'tests/checkout.spec.ts',
      sourceText: `await page.getByRole('button', { name: 'Pay' }).click(); await expect(page.getByText('Order confirmed')).toBeVisible();`,
    });
    expect(intent.actions).toContain('checkout');
    expect(intent.actions).toContain('payment');
    expect(intent.risk).toBe('critical');
    expect(intent.assertions.length).toBeGreaterThan(0);
    expect(intent.evidenceSources).toContain('test-title');
  });

  it('requires explicit evidence before treating business behavior as verified', () => {
    const registry = new BusinessOracleRegistry();
    registry.register(AssertionPreservationOracle);
    registry.register(ExecutionOracle);
    const intent = extractBusinessIntent({ id: 'login', title: 'login', sourceText: 'await expect(page).toBeVisible();' });
    const unavailable = registry.evaluate({ intent, executionPassed: true });
    expect(unavailable[0]?.status).toBe('unavailable');
    expect(unavailable[1]?.status).toBe('verified');

    const contradicted = registry.evaluate({
      intent,
      executionPassed: true,
      originalAssertions: ['expect total 99'],
      currentAssertions: ['expect total 0'],
    });
    expect(contradicted[0]?.status).toBe('contradicted');
  });

  it('combines locally provable assertion and execution evidence', () => {
    const intent = extractBusinessIntent({
      id: 'checkout',
      sourceText: "await expect(page.getByText('Paid')).toBeVisible();",
    });

    const verified = evaluateBuiltInBusinessOracles({
      intent,
      originalSourceText: "await expect(page.getByText('Paid')).toBeVisible();",
      currentSourceText: "await expect(page.getByText('Paid')).toBeVisible();",
      executionPassed: true,
    });
    expect(verified.status).toBe('verified');
    expect(verified.results.map((result) => result.status)).toEqual(['verified', 'verified']);

    const contradicted = evaluateBuiltInBusinessOracles({
      intent,
      originalSourceText: "await expect(page.getByText('Paid')).toBeVisible();",
      currentSourceText: "await expect(page.getByText('Failed')).toBeVisible();",
      executionPassed: true,
    });
    expect(contradicted.status).toBe('contradicted');
  });
});
