import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { IntentValidator } from '../../src/repair/intent-validator.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';
import { DiffAllowlistValidator } from '../../src/repair/diff-allowlist.js';
import { AstPatcher } from '../../src/repair/ast-patcher.js';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';
import { EvidenceCorrelator } from '../../src/diagnostics/evidence-correlator.js';
import { McpServer } from '../../src/mcp/server.js';
import { AbstentionPolicy, ScoredCandidate } from '../../src/selector/abstention-policy.js';
import { TraceAdapterRegistry } from '../../src/trace/adapters/adapter-registry.js';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('Adversarial Safety and Correctness Remediation Suite (Workstream 10)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-safety-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // 1. Rejects a repaired test that was never executed or failed execution
  it('ADV-01: should reject repair authorization when executionPassed is false', async () => {
    const specPath = path.resolve(tmpDir, 'test.spec.ts');
    await fs.writeFile(specPath, `test('login', async ({ page }) => { await expect(page).toHaveTitle('Login'); });`);

    const compFingerprint = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Login',
      attributes: {},
      text: 'Login',
      children: [],
    };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: compFingerprint,
      candidateElement: candidate,
      intendedAction: 'click',
      executionPassed: false, // Execution failed in sandbox
      strict: true,
    });

    expect(res.isValid).toBe(false);
    expect(res.executionVerified).toBe(false);
  });

  // 2. Rejects when executionPassed is undefined under strict verification
  it('ADV-02: should reject repair authorization when executionPassed is omitted in strict mode', async () => {
    const specPath = path.resolve(tmpDir, 'test.spec.ts');
    await fs.writeFile(specPath, `test('login', async ({ page }) => { await expect(page).toHaveTitle('Login'); });`);

    const compFingerprint = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Login',
      attributes: {},
      text: 'Login',
      children: [],
    };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: compFingerprint,
      candidateElement: candidate,
      intendedAction: 'click',
      executionPassed: undefined, // Omitted
      strict: true,
    });

    expect(res.isValid).toBe(false);
    expect(res.executionVerified).toBe(false);
  });

  // 3. Rejects missing diff-validation inputs under strict mode
  it('ADV-03: should reject repair authorization when diff-validation inputs are missing in strict mode', async () => {
    const specPath = path.resolve(tmpDir, 'test.spec.ts');
    await fs.writeFile(specPath, `test('login', async ({ page }) => { await expect(page).toHaveTitle('Login'); });`);

    const compFingerprint = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Login',
      attributes: {},
      text: 'Login',
      children: [],
    };

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: compFingerprint,
      candidateElement: candidate,
      intendedAction: 'click',
      executionPassed: true,
      strict: true, // Missing pageObjectOriginalSource, etc.
    });

    expect(res.isValid).toBe(false);
    expect(res.diffAllowlistPassed).toBe(false);
  });

  // 4. Rejects replacement button with contradictory business meaning (Cancel for Submit)
  it('ADV-04: should reject replacement candidate with opposing business meaning (Cancel for Submit)', async () => {
    const candidateCancel: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Cancel Order',
      attributes: {},
      text: 'Cancel Order',
      children: [],
    };

    const check = IntentValidator.verifyTargetIdentity('#submit-order-button', candidateCancel);
    expect(check.isPreserved).toBe(false);
    expect(check.reason).toContain('contradictory cancellation semantics');
  });

  // 5. Detects assertion tampering when whitespace inside string literals changes
  it('ADV-05: should detect assertion tampering when whitespace inside string literals is altered', async () => {
    const spec1 = path.resolve(tmpDir, 'spec1.ts');
    const spec2 = path.resolve(tmpDir, 'spec2.ts');

    await fs.writeFile(spec1, `test('t', async ({ page }) => { await expect(page.locator('.msg')).toHaveText('Payment  failed'); });`);
    await fs.writeFile(spec2, `test('t', async ({ page }) => { await expect(page.locator('.msg')).toHaveText('Payment failed'); });`);

    const hash1 = AssertionHasher.computeAssertionFingerprint(spec1);
    const hash2 = AssertionHasher.computeAssertionFingerprint(spec2);

    expect(hash1).not.toBe(hash2);
  });

  // 6. Detects fixture tampering when object key-values are swapped
  it('ADV-06: should detect fixture tampering when key-value pairs are swapped', async () => {
    const spec1 = path.resolve(tmpDir, 'spec1.ts');
    const spec2 = path.resolve(tmpDir, 'spec2.ts');

    await fs.writeFile(spec1, `const user = { username: 'admin', role: 'alice' };`);
    await fs.writeFile(spec2, `const user = { username: 'alice', role: 'admin' };`);

    const hash1 = AssertionHasher.computeFixtureFingerprint(spec1);
    const hash2 = AssertionHasher.computeFixtureFingerprint(spec2);

    expect(hash1).not.toBe(hash2);
  });

  // 7. Detects structural tampering when conditional operators change
  it('ADV-07: should detect structural tampering when conditional operator is negated (!user.isActive vs user.isActive)', async () => {
    const spec1 = path.resolve(tmpDir, 'spec1.ts');
    const spec2 = path.resolve(tmpDir, 'spec2.ts');

    await fs.writeFile(spec1, `test('flow', async () => { if (user.isActive) { await doWork(); } });`);
    await fs.writeFile(spec2, `test('flow', async () => { if (!user.isActive) { await doWork(); } });`);

    const hash1 = AssertionHasher.computeTestBodyFingerprint(spec1);
    const hash2 = AssertionHasher.computeTestBodyFingerprint(spec2);

    expect(hash1).not.toBe(hash2);
  });

  // 8. Rejects unauthorized new method added to Page Object class via DiffAllowlist
  it('ADV-08: should reject addition of unauthorized new class method via DiffAllowlist', () => {
    const orig = `export class LoginPage { readonly btn = this.page.locator('#btn'); }`;
    const patched = `export class LoginPage {
  readonly btn = this.page.getByRole('button', { name: 'Login' });
  injectedHelper() { return 'evil'; }
}`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'LoginPage',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain('Class method count changed');
  });

  // 9. Rejects added top-level helper function via DiffAllowlist
  it('ADV-09: should reject addition of top-level function via DiffAllowlist', () => {
    const orig = `export class LoginPage { readonly btn = this.page.locator('#btn'); }`;
    const patched = `function bypassAuth() { return true; }
export class LoginPage { readonly btn = this.page.getByRole('button', { name: 'Login' }); }`;

    const res = DiffAllowlistValidator.validate({
      originalSource: orig,
      patchedSource: patched,
      targetClassName: 'LoginPage',
      targetMemberName: 'btn',
    });

    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain('Top-level function declarations were added');
  });

  // 10. Rejects arbitrary executable replacement expressions via locator grammar validation
  it('ADV-10: should reject arbitrary executable replacement expression containing multiple statements or process calls', () => {
    const check1 = DiffAllowlistValidator.validateLocatorGrammar("this.page.locator('button'); process.exit(1);");
    expect(check1.isValid).toBe(false);

    const check2 = DiffAllowlistValidator.validateLocatorGrammar("require('fs').unlinkSync('main.ts')");
    expect(check2.isValid).toBe(false);

    const check3 = DiffAllowlistValidator.validateLocatorGrammar("(() => eval('bad'))()");
    expect(check3.isValid).toBe(false);
  });

  // 11. Rejects ambiguous Playwright locator match when matchCount !== 1
  it('ADV-11: should strictly abstain when candidate element matches multiple elements in DOM (matchCount === 2)', () => {
    const candidate: ScoredCandidate = {
      element: { tag: 'button', role: 'button', accessibleName: 'Submit', attributes: {}, children: [] },
      breakdown: {
        score: 0.90,
        transformedScore: 0.92,
        calibratedProbability: 0.92,
        uniqueness: 0.5,
        matchCount: 2, // 2 matching elements in DOM!
        identityMatch: 1.0,
        semanticMatch: 1.0,
        actionability: 1.0,
        historicalReliability: 0.8,
        historicalExecutionReliability: 0.8,
        volatilePenalty: 0.0,
        explanation: [],
      },
    };

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('STRICT_UNIQUENESS');
  });

  // 12. Unrelated backend 500 outside temporal window is excluded from causality
  it('ADV-12: should exclude historical 500 error occurring outside temporal window from causal graph', () => {
    const context: DiagnosticContext = {
      playwrightVersion: '1.45.0',
      traceFormatVersion: 10,
      failedAction: {
        callId: 'call@fail',
        action: 'page.click',
        selector: '#missing-btn',
        errorMessage: 'Timeout 30000ms exceeded waiting for locator("#missing-btn")',
        durationMs: 30000,
      },
      snapshots: { before: 'snap-1' },
      networkEvents: [
        // Error occurred 60 seconds ago (outside 5000ms window)
        { url: 'https://app.test/api/old-error', method: 'GET', status: 500, timestamp: 1000 },
        // Healthy requests during the action window
        { url: 'https://app.test/api/current', method: 'GET', status: 200, timestamp: 65000 },
      ],
      consoleEvents: [
        { type: 'log', text: 'Action triggered', timestamp: 65000 },
      ],
      evidenceCompleteness: { domAvailable: true, networkAvailable: true, sourceAvailable: true },
    };

    const correlated = EvidenceCorrelator.correlate(context, 5000);
    // Suspicious network events within the 5000ms window must be empty
    expect(correlated.suspiciousNetworkEvents.length).toBe(0);
  });

  // 13. Locator timeouts without DOM evidence abstain with INCOMPLETE_EVIDENCE
  it('ADV-13: should classify locator timeout without DOM evidence as INCOMPLETE_EVIDENCE and abstain', () => {
    const context: DiagnosticContext = {
      playwrightVersion: '1.45.0',
      traceFormatVersion: 10,
      failedAction: {
        callId: 'c1',
        action: 'page.click',
        selector: '#bad-selector',
        errorMessage: 'Timeout 30000ms exceeded waiting for locator("#bad-selector")',
      },
      snapshots: {},
      networkEvents: [],
      consoleEvents: [],
      evidenceCompleteness: {
        domAvailable: false, // DOM MISSING
        networkAvailable: false,
        sourceAvailable: true,
      },
    };

    const diagnosis = FailureClassifier.classify(context);
    expect(diagnosis.category).toBe('INCOMPLETE_EVIDENCE');
    expect(diagnosis.shouldAbstain).toBe(true);
    expect(diagnosis.abstentionReason).toContain('Insufficient DOM evidence');
  });

  // 14. Unsupported trace version triggers UNSUPPORTED_TRACE_FORMAT
  it('ADV-14: should resolve UnknownTraceAdapter for unrecognized schema version', () => {
    const manifest = { files: [] };
    const sampleLines = ['{"type":"version","version":99}'];

    const adapter = TraceAdapterRegistry.resolveAdapter(manifest, sampleLines);
    expect(adapter.adapterVersion).toBe('1.0.0-unsupported');
  });

  // 15. MCP server rejects attempts to access files outside authorized workspace
  it('ADV-15: should reject file operations outside workspace boundary in MCP server', async () => {
    const mcp = new McpServer(tmpDir);

    expect(() => {
      mcp.assertPathInWorkspace('../../etc/passwd');
    }).toThrow(/Workspace Security Violation/);

    expect(() => {
      mcp.assertPathInWorkspace('C:\\Windows\\System32\\cmd.exe');
    }).toThrow(/Workspace Security Violation/);
  });

  // 16. Positive verification: Legitimate locator repair preserves all invariants
  it('ADV-16: positive verification - legitimate locator repair satisfies all invariants', async () => {
    const specPath = path.resolve(tmpDir, 'legit.spec.ts');
    await fs.writeFile(
      specPath,
      `test('submit', async ({ page }) => {
  await page.click('#submit');
  await expect(page.locator('.success')).toBeVisible();
});`
    );

    const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Submit Form',
      attributes: { id: 'submit-new', 'data-testid': 'submit-btn' },
      text: 'Submit Form',
      children: [],
    };

    const origPom = `export class FormPage { readonly submitBtn = this.page.locator('#submit'); }`;
    const patchedPom = `export class FormPage { readonly submitBtn = this.page.getByRole('button', { name: 'Submit Form' }); }`;

    const res = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComposite,
      pageObjectOriginalSource: origPom,
      pageObjectPatchedSource: patchedPom,
      pageObjectClassName: 'FormPage',
      targetMemberName: 'submitBtn',
      candidateElement: candidate,
      intendedAction: 'click',
      originalSelector: '#submit',
      executionPassed: true,
      strict: true,
    });

    expect(res.isValid).toBe(true);
    expect(res.assertionsPreserved).toBe(true);
    expect(res.testBodyPreserved).toBe(true);
    expect(res.fixturesPreserved).toBe(true);
    expect(res.identityAndActionPreserved).toBe(true);
    expect(res.diffAllowlistPassed).toBe(true);
    expect(res.executionVerified).toBe(true);
  });
});
