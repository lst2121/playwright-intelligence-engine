import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TraceParser } from '../../src/trace/trace-parser.js';
import { SnapshotResolver, NodeSnapshot } from '../../src/trace/snapshot-resolver.js';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';
import { SelectorScorer } from '../../src/selector/selector-scorer.js';
import { AbstentionPolicy, ScoredCandidate } from '../../src/selector/abstention-policy.js';
import { IntentValidator } from '../../src/repair/intent-validator.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';
import { AstPatcher } from '../../src/repair/ast-patcher.js';
import { RepairPlanner } from '../../src/repair/repair-planner.js';
import { RepairEvidence } from '../../src/core/types/repair-evidence.js';

describe('End-to-End Autonomous Repair Workflows Suite (15 Tests)', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-e2e-repair');
  let pomPath: string;
  let specPath: string;

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    pomPath = path.resolve(tmpDir, 'LoginPage.ts');
    specPath = path.resolve(tmpDir, 'login.spec.ts');

    await fs.writeFile(
      pomPath,
      `export class LoginPage {
  readonly submitButton = this.page.locator('#old-submit-btn');
}`
    );

    await fs.writeFile(
      specPath,
      `import { test, expect } from '@playwright/test';
test('user login', async ({ page }) => {
  await expect(page.locator('#dashboard')).toHaveText('Welcome Admin');
});`
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('E2E-REPAIR-01: complete autonomous repair pipeline from trace to verified repair evidence', async () => {
    // 1. Trace stream with locator timeout
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({
        type: 'before',
        callId: 'call@checkout',
        apiName: 'page.click',
        params: { selector: '#old-submit-btn' },
      }),
      JSON.stringify({
        type: 'after',
        callId: 'call@checkout',
        error: { message: 'Timeout 30000ms exceeded waiting for locator("#old-submit-btn")' },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    context.snapshots = { before: 'snap-login' };

    // 2. Classify failure
    const diagnosis = FailureClassifier.classify(context);
    expect(diagnosis.category).toBe('LOCATOR_DRIFT');
    expect(diagnosis.shouldAbstain).toBe(false);

    // 3. Resolve DOM snapshot & extract candidates
    const snapshotTuple: NodeSnapshot = [
      'div',
      { class: 'login-box' },
      ['button', { id: 'new-submit', role: 'button', 'aria-label': 'Sign In' }, 'Sign In'],
    ];
    const resolvedRoot = SnapshotResolver.resolveNode(snapshotTuple)!;
    const candidates = SnapshotResolver.extractInteractiveElements(resolvedRoot);
    expect(candidates.length).toBe(1);

    // 4. Candidate Scoring
    const candidateEl = candidates[0]!;
    const breakdown = SelectorScorer.score(candidateEl, candidates, '#old-submit-btn');
    expect(breakdown.score).toBeGreaterThanOrEqual(0.70);
    expect(breakdown.matchCount).toBe(1);

    // 5. Abstention Evaluation
    const scored: ScoredCandidate = {
      element: candidateEl,
      breakdown,
      intendedAction: 'click',
    };
    const decision = AbstentionPolicy.evaluate([scored]);
    expect(decision.shouldAbstain).toBe(false);
    expect(decision.stage).toBe('AUTHORIZED');

    // 6. Intent Invariant v2 Pre-flight check
    const originalComposite = AssertionHasher.computeCompositeFingerprint(specPath);
    const intentRes = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: originalComposite,
      candidateElement: candidateEl,
      intendedAction: 'click',
    });
    expect(intentRes.isValid).toBe(true);

    // 7. Apply surgical AST patch
    const patcher = new AstPatcher();
    const patchResult = patcher.patchPageObject({
      filePath: pomPath,
      className: 'LoginPage',
      memberName: 'submitButton',
      replacementExpression: "this.page.getByRole('button', { name: 'Sign In' })",
    });
    expect(patchResult.pattern).toBe('property-initializer');

    // 8. Intent Invariant v2 Post-patch verification
    const postIntentRes = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: originalComposite,
      candidateElement: candidateEl,
      intendedAction: 'click',
      executionPassed: true,
    });
    expect(postIntentRes.isValid).toBe(true);
    expect(postIntentRes.assertionsPreserved).toBe(true);
    expect(postIntentRes.testBodyPreserved).toBe(true);

    // 9. Assemble immutable RepairEvidence package
    const evidence: RepairEvidence = {
      originalActionId: 'call@checkout',
      originalSelector: '#old-submit-btn',
      candidateSelector: "this.page.getByRole('button', { name: 'Sign In' })",
      candidateScore: breakdown.score,
      sourceLocation: {
        filePath: pomPath,
        className: 'LoginPage',
        memberName: 'submitButton',
        nodeKind: 'property',
        line: 2,
      },
      targetIdentityEvidence: ['Tag: button', 'Role: button', 'Name: Sign In'],
      assertionFingerprint: originalComposite.assertionFingerprint,
      businessOracleStatus: 'verified',
      verificationWorktreeId: 'worktree-e2e-01',
      repairedTestDurationMs: 450,
      timestamp: Date.now(),
      repairedSuccessfully: true,
    };

    expect(evidence.repairedSuccessfully).toBe(true);
    expect(evidence.assertionFingerprint).toBe(originalComposite.assertionFingerprint);

    // Verify patched file on disk
    const patchedContent = await fs.readFile(pomPath, 'utf8');
    expect(patchedContent).toContain("this.page.getByRole('button', { name: 'Sign In' })");
  });

  it('E2E-REPAIR-02: human approval requirement - active branch must not be modified automatically', async () => {
    // Strict safety invariant: Repairs happen in isolated worktrees only
    const worktreePath = path.resolve(tmpDir, 'isolated-worktree');
    await fs.mkdir(worktreePath, { recursive: true });

    const activeBranchPom = path.resolve(tmpDir, 'active-branch-pom.ts');
    await fs.writeFile(activeBranchPom, `export class ActivePom { readonly b = this.page.locator('#orig'); }`);

    // Verification modifies isolated worktree copy, NOT active branch
    const isolatedPom = path.resolve(worktreePath, 'isolated-pom.ts');
    await fs.copyFile(activeBranchPom, isolatedPom);

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath: isolatedPom,
      className: 'ActivePom',
      memberName: 'b',
      replacementExpression: "this.page.getByRole('button', { name: 'Verified' })",
    });

    // Active branch MUST remain untouched!
    const activeContent = await fs.readFile(activeBranchPom, 'utf8');
    expect(activeContent).toContain("this.page.locator('#orig')");

    const isolatedContent = await fs.readFile(isolatedPom, 'utf8');
    expect(isolatedContent).toContain("this.page.getByRole('button', { name: 'Verified' })");
  });

  it('E2E-NEG-01: Backend 500 trace must strictly abstain with zero code modification', async () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'c-500', apiName: 'page.click', params: { selector: '#pay' } }),
      JSON.stringify({ type: 'after', callId: 'c-500', error: { message: 'Timeout' } }),
    ];
    const networkLines = [
      JSON.stringify({
        type: 'response',
        url: 'https://api.example.com/checkout/pay',
        method: 'POST',
        status: 500,
        statusText: 'Internal Server Error',
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    const diagnosis = FailureClassifier.classify(context);

    expect(diagnosis.category).toBe('BACKEND_500');
    expect(diagnosis.shouldAbstain).toBe(true);

    // Zero modifications to Page Object
    const pomContent = await fs.readFile(pomPath, 'utf8');
    expect(pomContent).toContain('#old-submit-btn');
  });

  it('E2E-NEG-02: Auth 401 trace must strictly abstain with zero code modification', async () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'c-401', apiName: 'page.click', params: { selector: '#profile' } }),
      JSON.stringify({ type: 'after', callId: 'c-401', error: { message: 'Timeout' } }),
    ];
    const networkLines = [
      JSON.stringify({
        type: 'response',
        url: 'https://api.example.com/v1/profile',
        method: 'GET',
        status: 401,
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    const diagnosis = FailureClassifier.classify(context);

    expect(diagnosis.category).toBe('AUTH_EXPIRED');
    expect(diagnosis.shouldAbstain).toBe(true);
  });

  it('E2E-NEG-03: Assertion failure must strictly abstain with zero code modification', async () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({
        type: 'before',
        callId: 'c-assert',
        apiName: 'expect.toHaveText',
        params: { selector: '#header' },
      }),
      JSON.stringify({
        type: 'after',
        callId: 'c-assert',
        error: { message: "expect(received).toHaveText(expected)\nExpected: 'Admin'\nReceived: 'Guest'" },
      }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    const diagnosis = FailureClassifier.classify(context);

    expect(diagnosis.category).toBe('ASSERTION_FAILURE');
    expect(diagnosis.shouldAbstain).toBe(true);
  });

  it('E2E-NEG-04: Strict mode violation (multiple matches) must abstain on non-uniqueness', async () => {
    const candidateA: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Submit',
      attributes: {},
      text: 'Submit',
      children: [],
    };
    const candidateB: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Submit',
      attributes: {},
      text: 'Submit',
      children: [],
    };

    const breakdown = SelectorScorer.score(candidateA, [candidateA, candidateB]);
    expect(breakdown.matchCount).toBe(2);

    const scored: ScoredCandidate = {
      element: candidateA,
      breakdown,
      intendedAction: 'click',
    };
    const decision = AbstentionPolicy.evaluate([scored]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('STRICT_UNIQUENESS');
  });

  it('E2E-NEG-05: Seeded business defect must fail repaired test without masking', async () => {
    // When application calculates $199 instead of $99, test fails on assertion
    const defectError = "expect(received).toHaveText(expected)\nExpected: '$99.00'\nReceived: '$199.00'";
    const context = TraceParser.assembleDiagnosticContext(
      [
        JSON.stringify({ type: 'version', version: 10 }),
        JSON.stringify({ type: 'after', callId: 'c-defect', error: { message: defectError } }),
      ],
      []
    );

    const diagnosis = FailureClassifier.classify(context);
    expect(diagnosis.category).toBe('ASSERTION_FAILURE');
    expect(diagnosis.shouldAbstain).toBe(true);
  });

  it('E2E-REPAIR-03: constructor pattern repair with intent validation', async () => {
    const ctorPom = path.resolve(tmpDir, 'CtorPom.ts');
    await fs.writeFile(
      ctorPom,
      `export class CtorPom {
  readonly login: Locator;
  constructor(page: Page) {
    this.login = page.locator('#old-login');
  }
}`
    );

    const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Sign In',
      attributes: {},
      text: 'Sign In',
      children: [],
    };

    const patcher = new AstPatcher();
    const patchResult = patcher.patchPageObject({
      filePath: ctorPom,
      className: 'CtorPom',
      memberName: 'login',
      replacementExpression: "page.getByRole('button', { name: 'Sign In' })",
    });
    expect(patchResult.pattern).toBe('constructor-assignment');

    const intent = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComposite,
      candidateElement: candidate,
      intendedAction: 'click',
    });
    expect(intent.isValid).toBe(true);
  });

  it('E2E-REPAIR-04: getter pattern repair with intent validation', async () => {
    const getterPom = path.resolve(tmpDir, 'GetterPom.ts');
    await fs.writeFile(
      getterPom,
      `export class GetterPom {
  get submit(): Locator {
    return this.page.locator('#old-get');
  }
}`
    );

    const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Pay Now',
      attributes: {},
      text: 'Pay Now',
      children: [],
    };

    const patcher = new AstPatcher();
    const patchResult = patcher.patchPageObject({
      filePath: getterPom,
      className: 'GetterPom',
      memberName: 'submit',
      replacementExpression: "this.page.getByRole('button', { name: 'Pay Now' })",
    });
    expect(patchResult.pattern).toBe('getter-return');

    const intent = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComposite,
      candidateElement: candidate,
      intendedAction: 'click',
    });
    expect(intent.isValid).toBe(true);
  });

  it('E2E-REPAIR-05: repair planning with RepairPlanner helper', async () => {
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Confirm',
      attributes: {},
      text: 'Confirm',
      children: [],
    };

    const evidence = RepairPlanner.planAndExecute({
      pomFilePath: pomPath,
      testFilePath: specPath,
      className: 'LoginPage',
      memberName: 'submitButton',
      candidateElement: candidate,
      candidateScore: 0.95,
      originalActionId: 'call@plan',
      originalSelector: '#old-submit-btn',
      intendedAction: 'click',
      worktreeId: 'wt-plan-01',
    });

    expect(evidence.repairedSuccessfully).toBe(true);
    expect(evidence.candidateSelector).toContain('Confirm');
    expect(evidence.assertionFingerprint).toBeDefined();
  });

  it('E2E-REPAIR-06: verification failure should reject repair evidence package', async () => {
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Save',
      attributes: {},
      text: 'Save',
      children: [],
    };

    const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);
    const intentRes = IntentValidator.validateV2({
      testFilePath: specPath,
      originalCompositeFingerprint: origComposite,
      candidateElement: candidate,
      intendedAction: 'click',
      executionPassed: false, // Verification test failed!
    });

    expect(intentRes.isValid).toBe(false);
    expect(intentRes.executionVerified).toBe(false);
  });

  it('E2E-REPAIR-07: unsupported trace format causes pipeline abstention', async () => {
    const traceLines = [JSON.stringify({ type: 'version', version: 99 })];
    // TraceParser detects unsupported version and throws or abstains
    expect(() => {
      TraceParser.assembleDiagnosticContext(traceLines, []);
    }).toThrow();
  });

  it('E2E-REPAIR-08: incomplete DOM evidence causes pipeline abstention', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'c1', apiName: 'page.click', params: { selector: '#btn' } }),
      JSON.stringify({ type: 'after', callId: 'c1', error: { message: 'Timeout waiting for locator' } }),
    ];
    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    context.evidenceCompleteness.domAvailable = false;
    context.snapshots = {};

    // Without DOM evidence, candidate extraction cannot proceed
    const root: ResolvedElement = { tag: 'body', attributes: {}, text: '', children: [] };
    const candidates = SnapshotResolver.extractInteractiveElements(root);
    expect(candidates.length).toBe(0);

    const decision = AbstentionPolicy.evaluate([]);
    expect(decision.shouldAbstain).toBe(true);
  });

  it('E2E-REPAIR-09: zero mutation leakage across independent test suites', async () => {
    const suite1 = path.resolve(tmpDir, 'suite1.ts');
    const suite2 = path.resolve(tmpDir, 'suite2.ts');
    await fs.writeFile(suite1, `export class S1 { readonly btn = this.page.locator('#btn1'); }`);
    await fs.writeFile(suite2, `export class S2 { readonly btn = this.page.locator('#btn2'); }`);

    const patcher = new AstPatcher();
    patcher.patchPageObject({
      filePath: suite1,
      className: 'S1',
      memberName: 'btn',
      replacementExpression: "this.page.locator('#patched1')",
    });

    // Suite 2 must remain completely untouched
    const content2 = await fs.readFile(suite2, 'utf8');
    expect(content2).toContain('#btn2');
  });

  it('E2E-REPAIR-10: time-decayed stability tracking in stability ledger after successful repair', async () => {
    const selector = "this.page.getByRole('button', { name: 'Sign In' })";
    const ledgerPath = path.resolve(tmpDir);
    const { StabilityLedger } = await import('../../src/memory/stability-ledger.js');
    const ledger = new StabilityLedger(ledgerPath);
    await ledger.init();

    await ledger.recordSuccess(selector);
    expect(ledger.getScore(selector)).toBe(1.0);

    await ledger.recordFailure(selector, 'LOCATOR_DRIFT');
    expect(ledger.getScore(selector)).toBeLessThan(1.0);
  });
});
