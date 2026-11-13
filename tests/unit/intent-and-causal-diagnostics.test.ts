import { describe, it, expect } from 'vitest';
import { IntentValidator } from '../../src/repair/intent-validator.js';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';

describe('Phase 4 & 5: Intent Invariants & Causal Root Cause Diagnostics', () => {

  describe('Input Data Invariant Validation', () => {
    it('INVARIANT: should pass when input payloads are identical', () => {
      const orig = `await page.locator('#qty').fill('5'); await page.locator('#query').fill('mechanical keyboard');`;
      const patched = `await page.getByLabel('Quantity').fill('5'); await page.getByPlaceholder('Search').fill('mechanical keyboard');`;

      const result = IntentValidator.validateInputDataIntegrity(orig, patched);
      expect(result.isValid).toBe(true);
    });

    it('INVARIANT: should strictly reject when numerical input payload is tampered (e.g. 5 -> 1)', () => {
      const orig = `await page.locator('#qty').fill('5');`;
      const patched = `await page.getByLabel('Quantity').fill('1');`;

      const result = IntentValidator.validateInputDataIntegrity(orig, patched);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Action payload mutated from \'5\' to \'1\'');
    });

    it('INVARIANT: should strictly reject when string search input is tampered', () => {
      const orig = `await page.locator('#search').fill('laptop pro');`;
      const patched = `await page.getByPlaceholder('Search').fill('phone');`;

      const result = IntentValidator.validateInputDataIntegrity(orig, patched);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Action payload mutated from \'laptop pro\' to \'phone\'');
    });

    it('ADVERSARIAL: should strictly reject when input action is removed completely', () => {
      const orig = `await page.locator('#qty').fill('5'); await page.locator('#submit').click();`;
      // Patched completely deleted the fill operation
      const patched = `await page.locator('#submit').click();`;

      const result = IntentValidator.validateInputDataIntegrity(orig, patched);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Input action count changed from 1 to 0');
    });

    it('ADVERSARIAL: should strictly reject when additional unauthorized input is injected', () => {
      const orig = `await page.locator('#qty').fill('5');`;
      const patched = `await page.locator('#qty').fill('5'); await page.locator('#coupon').fill('FREE');`;

      const result = IntentValidator.validateInputDataIntegrity(orig, patched);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Input action count changed from 1 to 2');
    });
  });

  describe('Workflow Step Invariant Validation', () => {
    it('INVARIANT: should pass when all workflow steps are preserved', () => {
      const orig = `
        await page.goto('/checkout');
        await page.locator('#address').fill('123 Main St');
        await page.locator('#card').fill('4111222233334444');
        await page.locator('#submit').click();
      `;
      const patched = `
        await page.goto('/checkout');
        await page.getByLabel('Address').fill('123 Main St');
        await page.getByLabel('Card').fill('4111222233334444');
        await page.getByRole('button', { name: 'Submit Order' }).click();
      `;

      const result = IntentValidator.validateWorkflowStepIntegrity(orig, patched);
      expect(result.isValid).toBe(true);
    });

    it('INVARIANT: should strictly reject when an intermediate workflow step is skipped or deleted', () => {
      const orig = `
        await page.goto('/checkout');
        await page.locator('#address').fill('123 Main St');
        await page.locator('#shipping-method').click();
        await page.locator('#submit').click();
      `;
      // Bypassed shipping method selection step
      const patched = `
        await page.goto('/checkout');
        await page.locator('#address').fill('123 Main St');
        await page.locator('#submit').click();
      `;

      const result = IntentValidator.validateWorkflowStepIntegrity(orig, patched);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Workflow sequence invariant violated');
      expect(result.reason).toContain('step count changed from 4 to 3');
    });

    it('ADVERSARIAL: should strictly reject when workflow action order is swapped/reordered', () => {
      const orig = `
        await page.goto('/checkout');
        await page.locator('#address').fill('123 Main St');
        await page.locator('#submit').click();
      `;
      // Swapped order: click before fill
      const patched = `
        await page.goto('/checkout');
        await page.locator('#submit').click();
        await page.locator('#address').fill('123 Main St');
      `;

      const result = IntentValidator.validateWorkflowStepIntegrity(orig, patched);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Action sequence altered at step 2');
      expect(result.reason).toContain("expected 'fill', found 'click'");
    });
  });

  describe('Causal Root Cause vs Runtime Symptom Separation', () => {
    it('should decouple Timeout symptom from Backend 500 root cause', () => {
      const context: DiagnosticContext = {
        playwrightVersion: '1.49.0',
        traceFormatVersion: 9,
        failedAction: {
          action: 'click',
          selector: 'button.checkout-btn',
          errorMessage: 'TimeoutError: locator.click: Timeout 30000ms exceeded.',
          callId: 'call-1',
          timestamp: 1000,
        },
        networkEvents: [
          {
            url: 'http://localhost:3000/api/checkout',
            method: 'POST',
            status: 500,
            statusText: 'Internal Server Error',
            timestamp: 1050,
          },
        ],
        consoleEvents: [],
        snapshots: {
          action: '<button>Submit</button>',
        },
        evidenceCompleteness: {
          domAvailable: true,
          networkAvailable: true,
          sourceAvailable: true,
        },
      };

      const result = FailureClassifier.classify(context);

      expect(result.runtimeSymptom).toBe('TIMEOUT');
      expect(result.causalRootCause).toBe('BACKEND_500');
      expect(result.category).toBe('BACKEND_500');
      expect(result.shouldAbstain).toBe(true);
    });

    it('should decouple Timeout symptom from Locator Drift root cause', () => {
      const context: DiagnosticContext = {
        playwrightVersion: '1.49.0',
        traceFormatVersion: 9,
        failedAction: {
          action: 'click',
          selector: 'button#old-id',
          errorMessage: 'TimeoutError: locator.click: Timeout 30000ms exceeded waiting for locator("#old-id")',
          callId: 'call-2',
          timestamp: 1000,
        },
        networkEvents: [],
        consoleEvents: [],
        snapshots: {
          action: '<button id="new-id">Sign In</button>',
        },
        evidenceCompleteness: {
          domAvailable: true,
          networkAvailable: true,
          sourceAvailable: true,
        },
      };

      const result = FailureClassifier.classify(context);

      expect(result.runtimeSymptom).toBe('TIMEOUT');
      expect(result.causalRootCause).toBe('LOCATOR_DRIFT');
      expect(result.category).toBe('LOCATOR_DRIFT');
      expect(result.shouldAbstain).toBe(false);
    });

    it('should decouple Intercepted symptom from Obstructed Element root cause', () => {
      const context: DiagnosticContext = {
        playwrightVersion: '1.49.0',
        traceFormatVersion: 9,
        failedAction: {
          action: 'click',
          selector: 'button.save',
          errorMessage: 'Error: locator.click: <div class="modal-backdrop">...</div> intercepts pointer events',
          callId: 'call-3',
          timestamp: 1000,
        },
        networkEvents: [],
        consoleEvents: [],
        snapshots: {
          action: '<button>Submit</button>',
        },
        evidenceCompleteness: {
          domAvailable: true,
          networkAvailable: true,
          sourceAvailable: true,
        },
      };

      const result = FailureClassifier.classify(context);

      expect(result.runtimeSymptom).toBe('ACTION_INTERCEPTED');
      expect(result.causalRootCause).toBe('OBSTRUCTED_ELEMENT');
      expect(result.category).toBe('OBSTRUCTED_ELEMENT');
      expect(result.shouldAbstain).toBe(true);
    });

    it('should classify Assertion Failed symptom with Business Logic Defect root cause', () => {
      const context: DiagnosticContext = {
        playwrightVersion: '1.49.0',
        traceFormatVersion: 9,
        failedAction: {
          action: 'expect',
          errorMessage: 'Error: expect(received).toBe(expected) // Expected: 10, Received: 0',
          callId: 'call-4',
          timestamp: 1000,
        },
        networkEvents: [],
        consoleEvents: [],
        snapshots: {
          action: '<button>Submit</button>',
        },
        evidenceCompleteness: {
          domAvailable: true,
          networkAvailable: true,
          sourceAvailable: true,
        },
      };

      const result = FailureClassifier.classify(context);

      expect(result.runtimeSymptom).toBe('ASSERTION_FAILED');
      expect(result.causalRootCause).toBe('BUSINESS_LOGIC_DEFECT');
      expect(result.category).toBe('ASSERTION_FAILURE');
      expect(result.shouldAbstain).toBe(true);
    });
  });
});
