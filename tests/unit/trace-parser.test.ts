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
    context.snapshots = { action: '<button class="checkout">Checkout</button>' };
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

  it('should prefer the actionable failed step over an earlier fixture failure candidate', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'fixture@1', apiName: 'fixture', title: 'Fixture "page"', startTime: 100, stack: [] }),
      JSON.stringify({ type: 'after', callId: 'fixture@1', endTime: 200, error: { message: 'fixture setup warning' } }),
      JSON.stringify({ type: 'before', callId: 'click@1', apiName: 'page.click', params: { selector: '#submit' }, startTime: 300, stack: [{ file: 'tests/login.spec.ts', line: 12, column: 5 }] }),
      JSON.stringify({ type: 'after', callId: 'click@1', endTime: 5300, error: { message: 'Timeout waiting for locator("#submit")' } }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.failedAction.callId).toBe('click@1');
    expect(context.failedAction.selector).toBe('#submit');
  });

  it('should preserve standalone error trace records as failed-action evidence', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'error', callId: 'error@1', apiName: 'page.goto', message: 'net::ERR_CONNECTION_REFUSED', stack: [{ file: 'tests/setup.ts', line: 4 }] }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.failedAction.callId).toBe('error@1');
    expect(context.failedAction.errorMessage).toContain('ERR_CONNECTION_REFUSED');
    expect(FailureClassifier.classify(context).category).toBe('ENVIRONMENT_FAILURE');
  });

  it('should infer an assertion action from a parent test-step error', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'step@1', title: 'Administrator logged in!' }),
      JSON.stringify({
        type: 'after',
        callId: 'step@1',
        error: { message: "Expect failed: getByRole('link', { name: 'Rooms' }) with timeout 5000ms" },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.failedAction.action).toBe('expect');
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

  it('FRAME INTEGRITY: should prioritize main frame DOM when child iframe snapshots arrive later', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      // Action on main page
      JSON.stringify({
        type: 'before',
        callId: 'call@submit',
        apiName: 'page.click',
        params: { selector: 'button#submit-order' },
        startTime: 100,
        stack: [{ file: 'tests/checkout.spec.ts', line: 55, column: 5 }],
      }),
      // Main frame snapshot
      JSON.stringify({
        type: 'frame-snapshot',
        snapshot: {
          callId: 'call@init',
          frameId: 'frame@root',
          isMainFrame: true,
          node: ['html', {}, ['body', {}, ['button', { id: 'submit-order-v2', role: 'button' }, 'Place Order']]],
        },
      }),
      // Child iframe snapshot (e.g. Google Maps or Stripe embed loaded after main page)
      JSON.stringify({
        type: 'frame-snapshot',
        snapshot: {
          callId: 'call@maps',
          frameId: 'frame@google-maps',
          isMainFrame: false,
          node: ['html', {}, ['body', {}, ['div', { class: 'gm-style' }, 'Maps Canvas']]],
        },
      }),
      // Main page action failure
      JSON.stringify({
        type: 'after',
        callId: 'call@submit',
        endTime: 30100,
        error: {
          message: 'Timeout 30000ms exceeded while waiting for locator("button#submit-order")',
        },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.failedAction.callId).toBe('call@submit');
    // Main frame snapshot must NOT be clobbered by the Google Maps iframe!
    expect(context.snapshots.action).toContain('Place Order');
    expect(context.snapshots.action).not.toContain('Maps Canvas');
    expect((context as any).domRoot.tag).toBe('html');
  });

  it('FRAME INTEGRITY: should select child iframe DOM when failed action explicitly targets an iframe', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      // Action targeting an iframe element
      JSON.stringify({
        type: 'before',
        callId: 'call@frame-action',
        apiName: 'locator.click',
        params: { selector: 'iframe#stripe-frame >> internal:control' },
        startTime: 100,
        stack: [{ file: 'tests/payment.spec.ts', line: 88, column: 5 }],
      }),
      // Main frame snapshot
      JSON.stringify({
        type: 'frame-snapshot',
        snapshot: {
          frameId: 'frame@root',
          isMainFrame: true,
          node: ['html', {}, ['body', {}, ['h1', {}, 'Checkout']]],
        },
      }),
      // Child iframe snapshot
      JSON.stringify({
        type: 'frame-snapshot',
        snapshot: {
          frameId: 'frame@stripe',
          isMainFrame: false,
          node: ['html', {}, ['body', {}, ['input', { id: 'card-number', role: 'textbox' }, '']]],
        },
      }),
      // Action failure in iframe
      JSON.stringify({
        type: 'after',
        callId: 'call@frame-action',
        endTime: 30100,
        error: {
          message: 'Timeout 30000ms exceeded while waiting for locator("iframe#stripe-frame >> internal:control")',
        },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.failedAction.callId).toBe('call@frame-action');
    // Since selector targeted iframe, should use the child iframe DOM
    expect(context.snapshots.action).toContain('card-number');
  });
});

