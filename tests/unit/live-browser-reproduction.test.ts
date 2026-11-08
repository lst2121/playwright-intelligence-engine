import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium, Browser, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { LiveBrowserCollector } from '../../src/collectors/live-browser-collector.js';
import { LiveLocatorVerifier } from '../../src/selector/live-locator-verifier.js';
import { DirectBrowserInvestigator } from '../../src/reproduce/direct-browser-investigator.js';
import { DiagnosticRerunner } from '../../src/reproduce/diagnostic-rerunner.js';
import { ExecutionRunner } from '../../src/sandbox/execution-runner.js';
import { LocatorPlan } from '../../src/selector/candidate-extractor.js';

describe('Live Browser Reproduction & Verification Suite (Gate B)', () => {
  let browser: Browser;
  let page: Page;
  let tmpWorkspace: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-reproduce-test-'));
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (tmpWorkspace) await fs.rm(tmpWorkspace, { recursive: true, force: true }).catch(() => {});
  });

  // --- Category 1: Live Locator Plan Resolution & Live Verification ---
  it('LIVE-LOC-01: should verify unique getByRole locator with count() === 1 on live page', async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="btn-submit">Submit Order</button>
          <button id="btn-cancel">Cancel Order</button>
        </body>
      </html>
    `);

    const plan: LocatorPlan = {
      kind: 'getByRole',
      role: 'button',
      options: { name: 'Submit Order' },
    };

    const res = await LiveLocatorVerifier.verify(page, plan);
    expect(res.count).toBe(1);
    expect(res.isUnique).toBe(true);
    expect(res.isVisible).toBe(true);
    expect(res.isEnabled).toBe(true);
  });

  it('LIVE-LOC-02: should detect ambiguous duplicate elements and reject with count > 1', async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button class="action-btn">Duplicate Button</button>
          <button class="action-btn">Duplicate Button</button>
        </body>
      </html>
    `);

    const plan: LocatorPlan = {
      kind: 'getByRole',
      role: 'button',
      options: { name: 'Duplicate Button' },
    };

    const res = await LiveLocatorVerifier.verify(page, plan);
    expect(res.count).toBe(2);
    expect(res.isUnique).toBe(false);
    expect(res.reason).toContain('Strict Mode / Uniqueness Violation');
  });

  it('LIVE-LOC-03: should return count === 0 when element does not exist in live DOM', async () => {
    await page.setContent('<div><span>Empty page</span></div>');

    const plan: LocatorPlan = {
      kind: 'getByTestId',
      testId: 'missing-checkout-button',
    };

    const res = await LiveLocatorVerifier.verify(page, plan);
    expect(res.count).toBe(0);
    expect(res.isUnique).toBe(false);
    expect(res.reason).toContain('matched 0 elements');
  });

  // --- Category 2: Live Browser Collector Instrumentation & Redaction ---
  it('LIVE-COLL-01: should capture live console events with central redaction', async () => {
    const collector = new LiveBrowserCollector({ executionId: 'test-exec-1' });
    collector.attach(page);

    await page.evaluate(() => {
      console.log('User login attempt for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-fake');
      console.error('Database connection failed with password=SuperSecretPassword123');
    });

    // Small delay for event pump
    await new Promise((r) => setTimeout(r, 50));

    const records = await collector.collect();
    collector.detach();

    expect(records.length).toBeGreaterThanOrEqual(2);
    const consoleLogs = records.filter((r) => r.source === 'console');
    expect(consoleLogs.length).toBeGreaterThanOrEqual(1);

    const logRecord = consoleLogs[0];
    expect(logRecord.payload.text).toContain('Bearer [REDACTED]');
    expect(logRecord.redactionStatus.isRedacted).toBe(true);
  });

  it('LIVE-COLL-02: should capture live DOM snapshot with redacted password fields', async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <form>
            <input type="text" name="username" value="admin" />
            <input type="password" name="password" value="SuperSecretPassword123" />
            <input type="hidden" name="csrf_token" value="sensitive-csrf-token-abc" />
          </form>
        </body>
      </html>
    `);

    const collector = new LiveBrowserCollector({ executionId: 'test-exec-dom' });
    collector.attach(page);

    const snapshot = await collector.captureSnapshot('action');
    collector.detach();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.evidenceType).toBe('dom-snapshot');
    expect(snapshot!.payload.html).not.toContain('SuperSecretPassword123');
    expect(snapshot!.payload.html).toContain('[REDACTED]');
    expect(snapshot!.redactionStatus.isRedacted).toBe(true);
  });

  it('LIVE-COLL-03: should capture accessibility snapshot via page.ariaSnapshot()', async () => {
    await page.setContent(`
      <main>
        <h1>Shopping Cart</h1>
        <button>Proceed to Checkout</button>
      </main>
    `);

    const collector = new LiveBrowserCollector({ executionId: 'test-exec-aria' });
    collector.attach(page);

    const ariaSnapshot = await collector.captureAriaSnapshot();
    collector.detach();

    expect(ariaSnapshot).not.toBeNull();
    expect(ariaSnapshot!.evidenceType).toBe('accessibility-snapshot');
    expect(ariaSnapshot!.payload.ariaSnapshot).toBeDefined();
    expect(ariaSnapshot!.redactionStatus.isRedacted).toBe(true);
  });

  // --- Category 3: Diagnostic Rerunner Worktree Spec Path Containment ---
  it('RERUN-PATH-01: should reject absolute spec path escaping the workspace root', async () => {
    const outsideSpec = path.resolve(os.tmpdir(), 'outside.spec.ts');
    await fs.writeFile(outsideSpec, "test('outside', () => {});", 'utf-8');

    await expect(
      DiagnosticRerunner.rerunAndDiagnose({
        workspaceRoot: tmpWorkspace,
        specFilePath: outsideSpec,
        useWorktree: false,
      })
    ).rejects.toThrow(/Security Violation: Spec file .* escapes workspace root/);
  });

  it('RERUN-PATH-02: should accept in-workspace absolute spec path and compute worktree relative path', async () => {
    const insideSpec = path.resolve(tmpWorkspace, 'tests', 'sample.spec.ts');
    await fs.mkdir(path.dirname(insideSpec), { recursive: true });
    await fs.writeFile(insideSpec, "import { test } from '@playwright/test'; test('sample', () => {});", 'utf-8');

    const runSpy = vi.spyOn(ExecutionRunner, 'run').mockResolvedValueOnce({
      exitCode: 0,
      stdout: '1 passed (120ms)',
      stderr: '',
      durationMs: 120,
      timedOut: false,
      truncated: false,
    });

    const result = await DiagnosticRerunner.rerunAndDiagnose({
      workspaceRoot: tmpWorkspace,
      specFilePath: insideSpec,
      useWorktree: false,
      enableLiveEscalation: false,
    });

    expect(result.executedInWorktree).toBe(false);
    expect(result.targetSpecPath).toBe(insideSpec);
    expect(result.scorecard).toBeDefined();

    // Verify relative spec path was passed to Playwright runner, not original absolute path (B2)
    const relativeSpec = path.relative(tmpWorkspace, insideSpec).replace(/\\/g, '/');
    expect(runSpy).toHaveBeenCalledWith(
      'npx',
      expect.objectContaining({
        args: expect.arrayContaining(['playwright', 'test', relativeSpec]),
      })
    );
    runSpy.mockRestore();
  });

  // --- Category 4: DirectBrowserInvestigator Mode B ---
  it('DIRECT-INV-01: should launch direct browser investigation and verify locator candidate live', async () => {
    const res = await DirectBrowserInvestigator.investigateUrl(
      {
        url: 'data:text/html,<html><body><button id="direct-btn">Direct Probe</button></body></html>',
        executionId: 'probe-1',
      },
      {
        kind: 'getByRole',
        role: 'button',
        options: { name: 'Direct Probe' },
      }
    );

    expect(res.success).toBe(true);
    expect(res.domSnapshotRecord).not.toBeNull();
    expect(res.verificationResult).toBeDefined();
    expect(res.verificationResult!.isUnique).toBe(true);
    expect(res.verificationResult!.count).toBe(1);
    expect(res.records.length).toBeGreaterThan(0);
  }, 15000);

  it('DIRECT-INV-02: verifies an allowlisted browser operation in the same live page', async () => {
    const res = await DirectBrowserInvestigator.investigateUrl(
      {
        url: 'data:text/html,<html><body><button id="direct-btn">Direct Probe</button></body></html>',
        executionId: 'probe-operation-1',
        operation: {
          kind: 'replace_locator',
          target: 'Payment.submit',
          locator: "getByRole('button', { name: 'Direct Probe' })",
        },
        operationReplacementPlan: {
          kind: 'getByRole',
          role: 'button',
          options: { name: 'Direct Probe' },
        },
      }
    );

    expect(res.success).toBe(true);
    expect(res.browserOperationResult?.status).toBe('VERIFIED');
    expect(res.browserOperationResult?.action).toBe('verify');
  }, 15000);
});
