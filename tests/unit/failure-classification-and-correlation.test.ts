import { describe, it, expect } from 'vitest';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';
import { EvidenceCorrelator } from '../../src/diagnostics/evidence-correlator.js';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';

describe('Failure Classification and Causal Correlation Suite (40 Tests)', () => {
  const createBaseContext = (overrides?: Partial<DiagnosticContext>): DiagnosticContext => ({
    playwrightVersion: '1.64.1',
    traceFormatVersion: 10,
    failedAction: {
      callId: 'call@1',
      action: 'page.click',
      selector: '#submit-btn',
      errorMessage: 'Timeout 30000ms exceeded waiting for locator("#submit-btn")',
    },
    snapshots: { before: 'snap-1' },
    networkEvents: [],
    consoleEvents: [],
    evidenceCompleteness: {
      domAvailable: true,
      networkAvailable: true,
      sourceAvailable: true,
    },
    ...overrides,
  });

  // --- Category 1: Causal Evidence Graph & Telemetry Filtering (15 tests) ---
  const telemetryUrls = [
    'https://analytics.google.com/g/collect?v=2',
    'https://www.google-analytics.com/analytics.js',
    'https://stats.g.doubleclick.net/r/collect',
    'https://o12345.ingest.sentry.io/api/54321/envelope/',
    'https://browser-http-intake.logs.datadoghq.com/v1/input',
    'https://example.com/api/telemetry/events',
    'https://example.com/metrics',
    'https://example.com/beacon/ping',
    'https://static.hotjar.com/c/hotjar-123.js',
    'https://api.segment.io/v1/t',
    'https://example.com/favicon.ico',
  ];

  telemetryUrls.forEach((url, i) => {
    it(`CAUSAL-TELEM-${i + 1}: should ignore 500 on background telemetry endpoint: "${url}"`, () => {
      const context = createBaseContext({
        networkEvents: [
          {
            url,
            method: 'POST',
            status: 500,
            statusText: 'Internal Server Error',
            timestamp: 1000,
          },
        ],
      });

      const result = FailureClassifier.classify(context);
      // Because the 500 is on a background telemetry URL, it must NOT classify as BACKEND_500!
      // Primary symptom remains LOCATOR_DRIFT.
      expect(result.category).toBe('LOCATOR_DRIFT');
      expect(result.shouldAbstain).toBe(false);
      expect(result.causalGraph?.hasCausallyRelevantServerError).toBe(false);
    });
  });

  it('CAUSAL-SERVER-01: should classify as BACKEND_500 when application API returns HTTP 500', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://api.example.com/v1/orders/checkout',
          method: 'POST',
          status: 500,
          statusText: 'Internal Server Error',
          timestamp: 1200,
        },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('BACKEND_500');
    expect(result.shouldAbstain).toBe(true);
    expect(result.abstentionReason).toContain('Negative Control Triggered');
    expect(result.abstentionReason).toContain('500');
  });

  it('CAUSAL-SERVER-02: should classify as BACKEND_500 on Bad Gateway (HTTP 502)', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://api.example.com/v1/payment',
          method: 'POST',
          status: 502,
          statusText: 'Bad Gateway',
          timestamp: 1200,
        },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('BACKEND_500');
    expect(result.shouldAbstain).toBe(true);
    expect(result.abstentionReason).toContain('502');
  });

  it('CAUSAL-SERVER-03: should classify as BACKEND_500 on Service Unavailable (HTTP 503)', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://api.example.com/v1/inventory',
          method: 'GET',
          status: 503,
          statusText: 'Service Unavailable',
          timestamp: 1200,
        },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('BACKEND_500');
    expect(result.shouldAbstain).toBe(true);
  });

  it('CAUSAL-SERVER-04: should classify as BACKEND_500 on Gateway Timeout (HTTP 504)', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://api.example.com/v1/graphql',
          method: 'POST',
          status: 504,
          statusText: 'Gateway Timeout',
          timestamp: 1200,
        },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('BACKEND_500');
    expect(result.shouldAbstain).toBe(true);
  });

  // --- Category 2: Auth Expirations & Negative Controls (10 tests) ---
  it('AUTH-01: should classify HTTP 401 Unauthorized as AUTH_EXPIRED and abstain', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://api.example.com/v1/account/me',
          method: 'GET',
          status: 401,
          statusText: 'Unauthorized',
          timestamp: 1500,
        },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('AUTH_EXPIRED');
    expect(result.shouldAbstain).toBe(true);
    expect(result.abstentionReason).toContain('401');
  });

  it('AUTH-02: should classify HTTP 403 Forbidden as AUTH_EXPIRED and abstain', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://api.example.com/v1/admin/dashboard',
          method: 'GET',
          status: 403,
          statusText: 'Forbidden',
          timestamp: 1500,
        },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('AUTH_EXPIRED');
    expect(result.shouldAbstain).toBe(true);
    expect(result.abstentionReason).toContain('403');
  });

  it('AUTH-03: should prefer an explicit assertion mismatch over a related HTTP 401', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'call@assert-auth',
        action: 'expect',
        selector: '.alert-danger',
        errorMessage: 'Expect failed: Invalid credentials shown locator(\'.alert-danger\') with timeout 5000ms',
        logs: [
          'locator resolved to <div role="alert">Invalid credentials</div>',
          'unexpected value "Invalid credentials"',
        ],
      },
      networkEvents: [{
        url: 'https://api.example.com/login',
        method: 'POST',
        status: 401,
        statusText: 'Unauthorized',
        timestamp: 1500,
      }],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('ASSERTION_FAILURE');
    expect(result.shouldAbstain).toBe(true);
  });

  const assertionErrors = [
    "expect(received).toBe(expected)\nExpected: 200\nReceived: 500",
    "expect(locator).toHaveText(expected)\nExpected: 'Welcome back'\nReceived: 'Login'",
    "expect(received).toBeVisible()\nCall log: waiting for locator('#dialog')",
    "Error: received: 'Invalid username'\nexpected: 'Dashboard'",
    "expect(element).toHaveAttribute('data-status', 'active')",
  ];

  assertionErrors.forEach((err, idx) => {
    it(`ASSERTION-${idx + 1}: should classify assertion failure as ASSERTION_FAILURE and abstain: "${err.split('\n')[0]}"`, () => {
      const context = createBaseContext({
        failedAction: {
          callId: 'call@assert',
          action: 'expect.toHaveText',
          errorMessage: err,
        },
      });

      const result = FailureClassifier.classify(context);
      expect(result.category).toBe('ASSERTION_FAILURE');
      expect(result.shouldAbstain).toBe(true);
      expect(result.abstentionReason).toContain('prohibits modifying test assertions');
    });
  });

  it('STRICT-01: should classify strict mode violation as AMBIGUOUS_MATCH', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'call@strict',
        action: 'page.click',
        selector: 'button',
        errorMessage: 'Error: strict mode violation: locator("button") resolved to 4 elements',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('AMBIGUOUS_MATCH');
    expect(result.shouldAbstain).toBe(false); // Refinable candidate
  });

  it('STRICT-02: should detect resolved to multiple elements in error message', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'call@strict2',
        action: 'page.click',
        errorMessage: 'locator resolved to 2 elements: <button id="a">, <button id="b">',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('AMBIGUOUS_MATCH');
  });

  it('TIMING-01: should classify detached DOM node as TIMING_RACE and abstain', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'call@race',
        action: 'page.click',
        errorMessage: 'Error: element is not attached to the dom',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('TIMING_RACE');
    expect(result.shouldAbstain).toBe(true);
    expect(result.abstentionReason).toContain('Timing race condition');
  });

  // --- Category 3: Network Offline, Incomplete Evidence & Diagnostics (15 tests) ---
  it('OFFLINE-01: should classify ERR_INTERNET_DISCONNECTED as NETWORK_OFFLINE and abstain', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://example.com',
          method: 'GET',
          status: 0,
          errorText: 'net::ERR_INTERNET_DISCONNECTED',
          timestamp: 1000,
        },
      ],
      failedAction: {
        callId: 'call@offline',
        action: 'page.goto',
        errorMessage: 'page.goto: net::ERR_INTERNET_DISCONNECTED at https://example.com',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('NETWORK_OFFLINE');
    expect(result.shouldAbstain).toBe(true);
  });

  it('OFFLINE-02: should classify DNS lookup ENOTFOUND as NETWORK_OFFLINE', () => {
    const context = createBaseContext({
      networkEvents: [
        {
          url: 'https://invalid-host.example',
          method: 'GET',
          status: 0,
          errorText: 'getaddrinfo ENOTFOUND invalid-host.example',
          timestamp: 1000,
        },
      ],
      failedAction: {
        callId: 'call@dns',
        action: 'page.goto',
        errorMessage: 'net::ERR_NAME_NOT_RESOLVED ENOTFOUND',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('NETWORK_OFFLINE');
    expect(result.shouldAbstain).toBe(true);
  });

  it('OFFLINE-03: should classify Chromium ERR_NAME_NOT_RESOLVED as NETWORK_OFFLINE', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'call@dns',
        action: 'page.goto',
        errorMessage: 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.invalid',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('NETWORK_OFFLINE');
    expect(result.shouldAbstain).toBe(true);
  });

  it('ENVIRONMENT-01: should classify connection refused as ENVIRONMENT_FAILURE', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'call@connection-refused',
        action: 'page.goto',
        errorMessage: 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8000/',
      },
      networkEvents: [{
        url: 'http://localhost:8000/',
        method: 'GET',
        status: 0,
        errorText: 'connect ECONNREFUSED 127.0.0.1:8000',
        timestamp: 1000,
      }],
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('ENVIRONMENT_FAILURE');
    expect(result.shouldAbstain).toBe(true);
    expect(result.reason).toContain('unavailable');
  });

  it('ACTIONABILITY-01: should classify pointer interception as OBSTRUCTED_ELEMENT', () => {
    const result = FailureClassifier.classify(createBaseContext({
      failedAction: {
        callId: 'call@obstructed',
        action: 'page.click',
        selector: '#doLogin',
        errorMessage: 'locator.click: <div id="gdpr-modal-overlay"> intercepts pointer events',
      },
    }));
    expect(result.category).toBe('OBSTRUCTED_ELEMENT');
    expect(result.shouldAbstain).toBe(true);
  });

  it('ACTIONABILITY-02: should classify disabled controls as DISABLED_ELEMENT', () => {
    const result = FailureClassifier.classify(createBaseContext({
      failedAction: {
        callId: 'call@disabled',
        action: 'page.click',
        selector: '#doLogin',
        errorMessage: 'locator.click: element is disabled',
      },
    }));
    expect(result.category).toBe('DISABLED_ELEMENT');
    expect(result.shouldAbstain).toBe(true);
  });

  it('ACTIONABILITY-02B: should ignore browser launch flags when classifying disabled controls', () => {
    const result = FailureClassifier.classify(createBaseContext({
      failedAction: {
        callId: 'call@disabled-with-launch-noise',
        action: 'click',
        selector: '#doLogin',
        errorMessage:
          'locator.click: Test timeout\nBrowser logs:\n<launching> --lens-overlay --disable-popup-blocking <gracefully close start>\nCall log:\n - element is not enabled',
      },
    }));
    expect(result.category).toBe('DISABLED_ELEMENT');
  });

  it('ACTIONABILITY-03: should classify missing frame context as FRAME_OR_IFRAME', () => {
    const result = FailureClassifier.classify(createBaseContext({
      failedAction: {
        callId: 'call@frame',
        action: 'frameLocator.click',
        selector: 'iframe[title="Payment"] >> button',
        errorMessage: 'frame was detached while resolving the content frame',
      },
    }));
    expect(result.category).toBe('FRAME_OR_IFRAME');
    expect(result.shouldAbstain).toBe(true);
  });

  it('ACTIONABILITY-03B: should classify a contentFrame locator timeout as FRAME_OR_IFRAME', () => {
    const result = FailureClassifier.classify(createBaseContext({
      failedAction: {
        callId: 'call@content-frame',
        action: 'click',
        selector: "locator('#embedded-auth-frame').contentFrame().locator('#doLogin')",
        errorMessage: "locator.click: timeout waiting for locator('#embedded-auth-frame').contentFrame().locator('#doLogin')",
      },
    }));
    expect(result.category).toBe('FRAME_OR_IFRAME');
    expect(result.shouldAbstain).toBe(true);
  });

  it('ACTIONABILITY-04: should classify explicit hydration delay as HYDRATION_OR_TIMING', () => {
    const result = FailureClassifier.classify(createBaseContext({
      failedAction: {
        callId: 'call@hydration',
        action: 'page.click',
        selector: '#submit',
        errorMessage: 'Timeout waiting for hydration to complete before clicking',
      },
    }));
    expect(result.category).toBe('HYDRATION_OR_TIMING');
    expect(result.shouldAbstain).toBe(true);
  });

  it('EVIDENCE-01: should correlate suspicious network events in temporal window', () => {
    const context = createBaseContext({
      networkEvents: [
        { url: 'https://api.test/ok', method: 'GET', status: 200, timestamp: 1000 },
        { url: 'https://api.test/fail', method: 'POST', status: 500, timestamp: 1050 },
      ],
      consoleEvents: [
        { type: 'log', text: 'normal log', timestamp: 1000 },
        { type: 'error', text: 'Uncaught API Error', timestamp: 1050 },
      ],
    });

    const correlated = EvidenceCorrelator.correlate(context);
    expect(correlated.suspiciousNetworkEvents.length).toBe(1);
    expect(correlated.suspiciousNetworkEvents[0]?.url).toBe('https://api.test/fail');
    expect(correlated.suspiciousConsoleEvents.length).toBe(1);
    expect(correlated.suspiciousConsoleEvents[0]?.text).toContain('Uncaught API Error');
    expect(correlated.failureFingerprint.category).toBe('BACKEND_500');
    expect(correlated.failureFingerprint.key).toMatch(/^failure-[0-9a-f]{16}$/);
    expect(correlated.failureObservation.networkStatuses).toEqual([500]);
  });

  it('EVIDENCE-02: should classify generic timeout as LOCATOR_DRIFT when DOM available', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'c-drift',
        action: 'page.click',
        selector: 'button.checkout',
        errorMessage: 'Timeout 30000ms exceeded waiting for locator("button.checkout")',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('LOCATOR_DRIFT');
    expect(result.shouldAbstain).toBe(false);
  });

  it('EVIDENCE-02B: should abstain on a post-action assertion timeout without claiming locator drift', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'c-readiness',
        action: 'expect.toBeVisible',
        selector: "getByRole('link', { name: 'Rooms' })",
        errorMessage: "Expect failed: locator('getByRole(\\'link\\', { name: \\'Rooms\\' })') timeout 5000ms exceeded; element(s) not found",
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('HYDRATION_OR_TIMING');
    expect(result.shouldAbstain).toBe(true);
  });

  it('EVIDENCE-03: should classify unclassified error as UNKNOWN_ERROR and abstain', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'c-weird',
        action: 'unknown',
        errorMessage: 'Some unexpected custom hardware fault',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('UNKNOWN_ERROR');
    expect(result.shouldAbstain).toBe(true);
  });

  it('EVIDENCE-04: should include causal graph with all processed network nodes', () => {
    const context = createBaseContext({
      networkEvents: [
        { url: 'https://api.test/user', method: 'GET', status: 200, timestamp: 100 },
        { url: 'https://api.test/data', method: 'POST', status: 201, timestamp: 120 },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.causalGraph?.nodes.length).toBe(2);
    expect(result.causalGraph?.nodes[0]?.isCausallyRelevant).toBe(false);
  });

  it('EVIDENCE-05: should mark execution context destroyed as TIMING_RACE', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'c-ctx',
        action: 'page.click',
        errorMessage: 'Execution context was destroyed, most likely because of a navigation',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('TIMING_RACE');
    expect(result.shouldAbstain).toBe(true);
  });

  it('EVIDENCE-06: should mark navigation interrupted as TIMING_RACE', () => {
    const context = createBaseContext({
      failedAction: {
        callId: 'c-nav',
        action: 'page.click',
        errorMessage: 'Navigation interrupted by another navigation',
      },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('TIMING_RACE');
    expect(result.shouldAbstain).toBe(true);
  });

  it('EVIDENCE-07: should capture console warning without treating it as fatal error', () => {
    const context = createBaseContext({
      consoleEvents: [{ type: 'warn', text: 'Deprecated CSS property', timestamp: 100 }],
    });

    const correlated = EvidenceCorrelator.correlate(context);
    expect(correlated.suspiciousConsoleEvents.length).toBe(0);
  });

  it('EVIDENCE-08: should handle empty consoleEvents array without error', () => {
    const context = createBaseContext({ consoleEvents: [] });
    const correlated = EvidenceCorrelator.correlate(context);
    expect(correlated.suspiciousConsoleEvents).toEqual([]);
  });

  it('EVIDENCE-09: should handle empty networkEvents array without error', () => {
    const context = createBaseContext({ networkEvents: [] });
    const correlated = EvidenceCorrelator.correlate(context);
    expect(correlated.suspiciousNetworkEvents).toEqual([]);
  });

  it('EVIDENCE-10: should include supporting evidence array in classification result', () => {
    const context = createBaseContext({
      networkEvents: [
        { url: 'https://api.test/pay', method: 'POST', status: 500, timestamp: 100 },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.supportingEvidence.length).toBeGreaterThan(0);
    expect(result.supportingEvidence[0]).toContain('HTTP 500');
  });

  it('EVIDENCE-11: should provide confidence score above 0.90 for high-certainty classifications', () => {
    const context = createBaseContext({
      networkEvents: [
        { url: 'https://api.test/auth', method: 'POST', status: 401, timestamp: 100 },
      ],
    });

    const result = FailureClassifier.classify(context);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('EVIDENCE-12: should return lower confidence (0.50) on UNKNOWN_ERROR', () => {
    const context = createBaseContext({
      failedAction: { callId: 'c-x', action: 'x', errorMessage: 'mystery problem' },
    });

    const result = FailureClassifier.classify(context);
    expect(result.confidence).toBe(0.5);
  });

  it('EVIDENCE-13: should handle undefined error message in failedAction gracefully', () => {
    const context = createBaseContext({
      failedAction: { callId: 'c-null', action: 'x', errorMessage: undefined },
    });

    const result = FailureClassifier.classify(context);
    expect(result.category).toBe('UNKNOWN_ERROR');
    expect(result.shouldAbstain).toBe(true);
  });
});
