import { describe, it, expect } from 'vitest';
import { ErrorCollector } from '../../src/collectors/error-collector.js';
import { StaticAstCollector } from '../../src/collectors/static-ast-collector.js';
import { NetworkCollector } from '../../src/collectors/network-collector.js';
import { LiveBrowserCollector } from '../../src/collectors/live-browser-collector.js';
import { EnvironmentCollector } from '../../src/collectors/environment-collector.js';
import { GitDiffCollector } from '../../src/collectors/git-diff-collector.js';
import { EvidenceNormalizer } from '../../src/evidence/evidence-normalizer.js';
import { UnifiedEvidenceRecord } from '../../src/evidence/evidence-model.js';
import * as path from 'path';

describe('Multi-Source Evidence Collectors & Normalizer Suite', () => {
  it('COLLECT-ERR-01: should parse Playwright TimeoutError and extract selector and action', async () => {
    const collector = new ErrorCollector();
    const records = await collector.collect({
      errorMessage: 'Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator("button.submit-btn")\n  - locator resolved to <button class="submit-btn">...\n  - attempting click action',
      errorStack: 'Error: Timeout 30000ms exceeded.\n    at LoginPage.submit (d:/Work/app/pages/LoginPage.ts:45:20)\n    at d:/Work/app/specs/login.spec.ts:18:9',
      testTitle: 'should log in successfully',
    });

    expect(records.length).toBe(1);
    const rec = records[0];
    expect(rec.source).toBe('error');
    expect(rec.evidenceType).toBe('playwright-error');
    expect(rec.payload.errorType).toBe('TimeoutError');
    expect(rec.payload.action).toBe('click');
    expect(rec.payload.selector).toBe('button.submit-btn');
    expect(rec.payload.sourceFile).toContain('LoginPage.ts');
    expect(rec.payload.line).toBe(45);
  });

  it('COLLECT-ERR-02: should parse StrictModeViolation error', async () => {
    const collector = new ErrorCollector();
    const records = await collector.collect({
      errorMessage: 'Error: strict mode violation: locator("input.text") resolved to 3 elements',
      testFile: 'specs/form.spec.ts',
      line: 25,
      column: 10,
    });

    const rec = records[0];
    expect(rec.payload.isStrictModeViolation).toBe(true);
    expect(rec.payload.errorType).toBe('StrictModeViolation');
    expect(rec.payload.selector).toBe('input.text');
  });

  it('COLLECT-AST-01: should extract Page Object properties, getters, and constructor locators', async () => {
    const pomContent = `
import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly header = this.page.locator('h1.dashboard-title');

  constructor(page: Page) {
    this.page = page;
    this.logoutBtn = page.getByRole('button', { name: 'Log out' });
  }

  get userMenu(): Locator {
    return this.page.locator('[data-testid="user-menu"]');
  }

  async logout() {
    await this.logoutBtn.click();
  }
}
`;
    const collector = new StaticAstCollector();
    const records = await collector.collect({
      targetFilePath: 'DashboardPage.ts',
      sourceContent: pomContent,
    });

    expect(records.length).toBe(1);
    const rec = records[0];
    expect(rec.source).toBe('static-ast');
    expect(rec.payload.isPageObject).toBe(true);
    expect(rec.payload.locators.length).toBe(3);

    const names = rec.payload.locators.map((l: any) => l.propertyName);
    expect(names).toContain('header');
    expect(names).toContain('logoutBtn');
    expect(names).toContain('userMenu');
  });

  it('COLLECT-NET-01: should collect and redact network events with high reliability', async () => {
    const collector = new NetworkCollector();
    const records = await collector.collect({
      events: [
        {
          url: 'https://api.mybank.com/v1/auth',
          method: 'POST',
          status: 401,
          statusText: 'Unauthorized',
          headers: {
            Authorization: 'Bearer secret-jwt-here',
            'Content-Type': 'application/json',
          },
          errorText: 'Session expired',
        },
      ],
    });

    expect(records.length).toBe(1);
    const rec = records[0];
    expect(rec.source).toBe('network');
    expect(rec.payload.status).toBe(401);
    expect(rec.payload.headers.Authorization).toBe('[REDACTED]');
    expect(rec.payload.isError).toBe(true);
  });

  it('COLLECT-LIVE-01: should attach listeners to page and capture console/error events', async () => {
    const collector = new LiveBrowserCollector({ executionId: 'exec-test' });

    // Mock Playwright Page
    const listeners: Record<string, Function> = {};
    const mockPage = {
      on: (evt: string, fn: Function) => {
        listeners[evt] = fn;
      },
      off: (evt: string) => {
        delete listeners[evt];
      },
      content: async () => '<html><body><button id="btn">Submit</button></body></html>',
      url: () => 'https://app.test/login',
    };

    collector.attach(mockPage);

    // Trigger console event
    listeners['console']({
      text: () => 'Uncaught TypeError: Cannot read properties of undefined',
      type: () => 'error',
      location: () => ({ url: 'app.js', lineNumber: 10 }),
    });

    // Capture DOM snapshot
    const snap = await collector.captureSnapshot('action');
    expect(snap).not.toBeNull();
    expect(snap?.payload.html).toContain('<button id="btn">');

    const records = await collector.collect();
    expect(records.length).toBe(2);
    expect(records[0].source).toBe('console');
    expect(records[1].source).toBe('live-browser');

    collector.detach();
  });

  it('COLLECT-ENV-01: should collect sanitized environment metadata', async () => {
    const collector = new EnvironmentCollector();
    const records = await collector.collect({ workspaceRoot: process.cwd() });

    expect(records.length).toBe(1);
    const rec = records[0];
    expect(rec.payload.nodeVersion).toBe(process.version);
    expect(rec.payload.platform).toBe(process.platform);
    expect(typeof rec.payload.cpuCount).toBe('number');
  });

  it('NORM-01: should compute accurate EvidenceScorecard across diverse sources', () => {
    const records: UnifiedEvidenceRecord[] = [
      {
        evidenceId: 'e1',
        executionId: 'x1',
        source: 'error',
        timestamp: 1,
        evidenceType: 'playwright-error',
        payload: { errorMessage: 'failed' },
        reliability: 'HIGH',
        provenance: { collector: 'test', collectedAt: 1, captureMethod: 'test' },
        redactionStatus: { isRedacted: false },
      },
      {
        evidenceId: 'e2',
        executionId: 'x1',
        source: 'static-ast',
        timestamp: 2,
        evidenceType: 'ast-analysis',
        payload: { locators: [] },
        reliability: 'HIGH',
        provenance: { collector: 'test', collectedAt: 2, captureMethod: 'test' },
        redactionStatus: { isRedacted: false },
      },
      {
        evidenceId: 'e3',
        executionId: 'x1',
        source: 'network',
        timestamp: 3,
        evidenceType: 'http-response',
        payload: { url: 'https://test.com', status: 500 },
        reliability: 'HIGH',
        provenance: { collector: 'test', collectedAt: 3, captureMethod: 'test' },
        redactionStatus: { isRedacted: false },
      },
    ];

    const scorecard = EvidenceNormalizer.calculateScorecard(records);
    expect(scorecard.playwrightErrorAvailable).toBe(true);
    expect(scorecard.testSourceAstAvailable).toBe(true);
    expect(scorecard.networkEventsAvailable).toBe(true);
    expect(scorecard.traceArchiveAvailable).toBe(false);
    expect(scorecard.domSnapshotAvailable).toBe(false);
    expect(scorecard.totalRecordsCount).toBe(3);
    expect(scorecard.availableSources).toContain('error');
    expect(scorecard.availableSources).toContain('static-ast');
    expect(scorecard.availableSources).toContain('network');
  });

  it('NORM-02: should convert multi-source UnifiedEvidenceRecords into DiagnosticContext', () => {
    const records: UnifiedEvidenceRecord[] = [
      {
        evidenceId: 'err-1',
        executionId: 'x1',
        source: 'error',
        timestamp: 1000,
        actionId: 'call@42',
        evidenceType: 'playwright-error',
        payload: {
          action: 'click',
          selector: '#submit-btn',
          errorMessage: 'Timeout 30000ms waiting for locator("#submit-btn")',
          sourceFile: 'specs/test.spec.ts',
          line: 14,
        },
        reliability: 'HIGH',
        provenance: { collector: 'ErrorCollector', collectedAt: 1000, captureMethod: 'parse' },
        redactionStatus: { isRedacted: false },
      },
      {
        evidenceId: 'dom-1',
        executionId: 'x1',
        source: 'live-browser',
        timestamp: 1001,
        evidenceType: 'dom-snapshot',
        payload: {
          phase: 'action',
          html: '<html><body><button id="real-submit">Submit</button></body></html>',
        },
        reliability: 'HIGH',
        provenance: { collector: 'LiveBrowserCollector', collectedAt: 1001, captureMethod: 'cdp' },
        redactionStatus: { isRedacted: false },
      },
      {
        evidenceId: 'net-1',
        executionId: 'x1',
        source: 'network',
        timestamp: 950,
        requestId: 'req-1',
        evidenceType: 'http-response',
        payload: {
          url: 'https://api.test.com/data',
          method: 'GET',
          status: 200,
        },
        reliability: 'HIGH',
        provenance: { collector: 'NetworkCollector', collectedAt: 950, captureMethod: 'cdp' },
        redactionStatus: { isRedacted: false },
      },
    ];

    const context = EvidenceNormalizer.toDiagnosticContext(records);
    expect(context.failedAction.action).toBe('click');
    expect(context.failedAction.selector).toBe('#submit-btn');
    expect(context.failedAction.sourceFile).toBe('specs/test.spec.ts');
    expect(context.snapshots.action).toContain('real-submit');
    expect(context.networkEvents.length).toBe(1);
    expect(context.networkEvents[0].url).toBe('https://api.test.com/data');
    expect(context.evidenceCompleteness.domAvailable).toBe(true);
    expect(context.evidenceCompleteness.networkAvailable).toBe(true);
  });
});
