import { describe, it, expect } from 'vitest';
import { EvidenceCorrelator } from '../../src/diagnostics/evidence-correlator.js';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';
import { DiagnosticReportGenerator } from '../../src/diagnostics/diagnostic-report.js';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';
import { EvidenceScorecard } from '../../src/evidence/evidence-model.js';

describe('Causal Correlator & Action-Anchored Temporal Windowing Suite', () => {
  const baseContext: DiagnosticContext = {
    playwrightVersion: '1.40.0',
    traceFormatVersion: 10,
    failedAction: {
      callId: 'call@action-1',
      action: 'click',
      selector: 'button#checkout',
      timestamp: 10000, // Failed action at T=10,000ms
      durationMs: 5000,
      frameId: 'main-frame',
      errorMessage: 'Timeout 5000ms exceeded waiting for locator("button#checkout")',
    },
    snapshots: {
      action: '<html><body><button id="cart">Cart</button></body></html>',
    },
    networkEvents: [],
    consoleEvents: [],
    evidenceCompleteness: {
      domAvailable: true,
      networkAvailable: true,
      sourceAvailable: true,
    },
  };

  it('CORRELATE-01: should anchor temporal window to failedAction.timestamp, ignoring teardown noise', () => {
    const context: DiagnosticContext = {
      ...baseContext,
      networkEvents: [
        // 1. Relevant server error in window [5000, 11000]
        {
          url: 'https://api.store.com/checkout/initiate',
          method: 'POST',
          status: 500,
          timestamp: 8500, // Inside [5000, 11000]
        },
        // 2. Old error far before window
        {
          url: 'https://api.store.com/catalog/warmup',
          method: 'GET',
          status: 500,
          timestamp: 2000, // Before window (< 5000)
        },
        // 3. Post-teardown log far after action
        {
          url: 'https://api.store.com/session/terminate',
          method: 'POST',
          status: 503,
          timestamp: 25000, // Far after action (> 11000)
        },
      ],
      consoleEvents: [
        // Console error inside window
        {
          type: 'error',
          text: 'Checkout service unavailable: 500',
          timestamp: 8600,
        },
        // Console error after action in teardown
        {
          type: 'error',
          text: 'Teardown failure',
          timestamp: 30000,
        },
      ],
    };

    const correlated = EvidenceCorrelator.correlate(context, 5000);

    // Only the network error in [5000, 11000] should be correlated
    expect(correlated.suspiciousNetworkEvents.length).toBe(1);
    expect(correlated.suspiciousNetworkEvents[0].url).toContain('/checkout/initiate');

    // Only the console error in [5000, 11000] should be correlated
    expect(correlated.suspiciousConsoleEvents.length).toBe(1);
    expect(correlated.suspiciousConsoleEvents[0].text).toContain('Checkout service unavailable');
  });

  it('CORRELATE-02: should prioritize network events from the same frame as the failed action', () => {
    const context: DiagnosticContext = {
      ...baseContext,
      networkEvents: [
        {
          url: 'https://iframe.partner.com/ad',
          method: 'GET',
          status: 500,
          timestamp: 9000,
          frameId: 'iframe-ad',
        },
        {
          url: 'https://api.store.com/order',
          method: 'POST',
          status: 500,
          timestamp: 9100,
          frameId: 'main-frame', // Matches failedAction.frameId
        },
      ],
    };

    const correlated = EvidenceCorrelator.correlate(context);
    expect(correlated.suspiciousNetworkEvents.length).toBe(2);
    // Same frame should be sorted first!
    expect(correlated.suspiciousNetworkEvents[0].frameId).toBe('main-frame');
  });

  it('CORRELATE-03: should populate explicit edges in CausalEvidenceGraph', () => {
    const context: DiagnosticContext = {
      ...baseContext,
      networkEvents: [
        {
          url: 'https://api.store.com/checkout/pay',
          method: 'POST',
          status: 500,
          timestamp: 9500,
          frameId: 'main-frame',
          requestId: 'req-pay-1',
        },
      ],
    };

    const classification = FailureClassifier.classify(context);
    expect(classification.causalGraph).toBeDefined();
    const g = classification.causalGraph!;

    expect(g.actionNode).toBeDefined();
    expect(g.actionNode?.id).toBe('call@action-1');

    const edgeRelations = g.edges.map((e) => e.relation);
    expect(edgeRelations).toContain('SUPPORTS'); // 500 error supports failure
    expect(edgeRelations).toContain('TEMPORALLY_PRECEDES'); // 9500 <= 10000
    expect(edgeRelations).toContain('SAME_FRAME'); // 'main-frame' === 'main-frame'
  });

  it('REPORT-01: should render EvidenceScorecard in Terminal and Markdown reports', () => {
    const correlated = EvidenceCorrelator.correlate(baseContext);

    const scorecard: EvidenceScorecard = {
      playwrightErrorAvailable: true,
      testSourceAstAvailable: true,
      domSnapshotAvailable: true,
      consoleEventsAvailable: false,
      networkEventsAvailable: false,
      traceArchiveAvailable: false,
      gitHistoryAvailable: true,
      environmentMetadataAvailable: true,
      totalRecordsCount: 5,
      availableSources: ['error', 'static-ast', 'live-browser', 'git-diff', 'environment'],
      unavailableSources: ['console', 'network', 'trace'],
    };

    const terminalReport = DiagnosticReportGenerator.generateTerminalReport(correlated, scorecard);
    expect(terminalReport).toContain('Multi-Source Evidence Scorecard:');
    expect(terminalReport).toContain('Playwright Error Msg   : ✅ YES');
    expect(terminalReport).toContain('Trace Archive          : ❌ NO');

    const mdReport = DiagnosticReportGenerator.generateMarkdownReport(correlated, scorecard);
    expect(mdReport).toContain('| Playwright Error Message | ✅ |');
    expect(mdReport).toContain('| Playwright Trace | ❌ |');
  });
});

