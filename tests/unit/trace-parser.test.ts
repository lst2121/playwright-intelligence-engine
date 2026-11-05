import { describe, it, expect } from 'vitest';
import { TraceParser } from '../../src/trace/trace-parser.js';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';

describe('TraceParser & FailureClassifier Unit Tests', () => {
  it('should parse paired before/after trace events and extract failed action', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 6 }),
      JSON.stringify({
        type: 'before',
        callId: 'call@1',
        apiName: 'page.click',
        params: { selector: 'button.btn-checkout' },
        wallTime: 1000,
        stack: [{ file: 'd:/tests/checkout.spec.ts', line: 42, column: 5 }],
      }),
      JSON.stringify({
        type: 'after',
        callId: 'call@1',
        endTime: 31000,
        error: {
          error: {
            message: 'Timeout 30000ms exceeded while waiting for locator("button.btn-checkout")',
            stack: 'TimeoutError: ... at d:/tests/checkout.spec.ts:42:5',
          },
        },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    // Populate DOM snapshot evidence to verify LOCATOR_DRIFT classification with available DOM
    context.snapshots = { 'call@1': { html: '<button class="checkout">Checkout</button>' } as any };
    context.evidenceCompleteness.domAvailable = true;

    expect(context.traceFormatVersion).toBe(6);
    expect(context.failedAction.callId).toBe('call@1');
    expect(context.failedAction.action).toBe('page.click');
    expect(context.failedAction.selector).toBe('button.btn-checkout');
    expect(context.failedAction.line).toBe(42);
    expect(context.failedAction.durationMs).toBe(30000);

    const classification = FailureClassifier.classify(context);
    expect(classification.category).toBe('LOCATOR_DRIFT');
    expect(classification.shouldAbstain).toBe(false);
  });

  it('NEGATIVE CONTROL 1: should strictly ABSTAIN when backend returns HTTP 500', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 6 }),
      JSON.stringify({
        type: 'before',
        callId: 'call@2',
        apiName: 'page.click',
        params: { selector: '#submit-order' },
      }),
      JSON.stringify({
        type: 'after',
        callId: 'call@2',
        error: {
          error: {
            message: 'Timeout 30000ms exceeded waiting for locator("#submit-order")',
          },
        },
      }),
    ];

    const networkLines = [
      JSON.stringify({
        type: 'resource-snapshot',
        snapshot: {
          request: { url: 'https://api.example.com/checkout/pay', method: 'POST' },
          response: { status: 500, statusText: 'Internal Server Error' },
          wallTime: 1500,
        },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    const classification = FailureClassifier.classify(context);

    expect(classification.category).toBe('BACKEND_500');
    expect(classification.shouldAbstain).toBe(true);
    expect(classification.abstentionReason).toContain('Negative Control Triggered');
    expect(classification.abstentionReason).toContain('500');
  });

  it('NEGATIVE CONTROL 2: should strictly ABSTAIN when authentication session expires (HTTP 401)', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 6 }),
      JSON.stringify({
        type: 'before',
        callId: 'call@3',
        apiName: 'page.fill',
        params: { selector: 'input[name="employee_name"]' },
      }),
      JSON.stringify({
        type: 'after',
        callId: 'call@3',
        error: {
          error: {
            message: 'Timeout waiting for locator("input[name=\\"employee_name\\"]")',
          },
        },
      }),
    ];

    const networkLines = [
      JSON.stringify({
        type: 'resource-snapshot',
        snapshot: {
          request: { url: 'https://orangehrm.example.com/api/v2/pim/employees', method: 'GET' },
          response: { status: 401, statusText: 'Unauthorized' },
          wallTime: 1200,
        },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    const classification = FailureClassifier.classify(context);

    expect(classification.category).toBe('AUTH_EXPIRED');
    expect(classification.shouldAbstain).toBe(true);
    expect(classification.abstentionReason).toContain('401');
  });

  it('NEGATIVE CONTROL 3: should strictly ABSTAIN on assertion failures', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 6 }),
      JSON.stringify({
        type: 'before',
        callId: 'call@4',
        apiName: 'expect.toHaveText',
      }),
      JSON.stringify({
        type: 'after',
        callId: 'call@4',
        error: {
          error: {
            message: 'Error: expect(received).toHaveText(expected)\n\nExpected: "$500"\nReceived: "$550"',
          },
        },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    const classification = FailureClassifier.classify(context);

    expect(classification.category).toBe('ASSERTION_FAILURE');
    expect(classification.shouldAbstain).toBe(true);
    expect(classification.abstentionReason).toContain('prohibits modifying test assertions');
  });
});

