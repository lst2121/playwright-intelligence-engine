import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IntentValidator, VerifiedExecutionProof } from '../../src/repair/intent-validator.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';
import { StatementDiffAllowlistValidator, DiffAllowlistValidator } from '../../src/repair/diff-allowlist.js';
import { StatementPatcher } from '../../src/repair/statement-patcher.js';
import { RepairPlanner } from '../../src/repair/repair-planner.js';
import { ExecutionRunner } from '../../src/sandbox/execution-runner.js';
import {
  AssertionTamperedError,
  AbstentionError,
  UnauthorizedAstModificationError,
} from '../../src/core/errors/engine-errors.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('Phase 10 — Complete Adversarial Invariant Suite (INV-01 to INV-20)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-inv-suite-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // INV-01: Delete existing assertion -> Reject
  it('INV-01: should reject patch that deletes an existing business assertion', async () => {
    const origSource = `import { test, expect } from '@playwright/test';
test('order', async ({ page }) => {
  await page.locator('#buy').click();
  await expect(page.locator('.success')).toBeVisible();
});`;
    const patchedSource = `import { test, expect } from '@playwright/test';
test('order', async ({ page }) => {
  await page.locator('#buy').click();
});`;
    const specPath = path.join(tmpDir, 'test.spec.ts');
    await fs.writeFile(specPath, origSource, 'utf8');
    const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);

    expect(() => {
      IntentValidator.validateV2({
        testFilePath: specPath,
        originalCompositeFingerprint: origComposite,
        pageObjectOriginalSource: origSource,
        pageObjectPatchedSource: patchedSource,
        candidateElement: { tag: 'button', attributes: {}, text: 'Buy', children: [] },
        intendedAction: 'click',
        pattern: 'statement-patch',
      });
    }).toThrow(AssertionTamperedError);
  });

  // INV-02: Change assertion matcher -> Reject
  it('INV-02: should reject patch that modifies an assertion matcher', async () => {
    const origSource = `import { test, expect } from '@playwright/test';
test('status', async ({ page }) => {
  await expect(page.locator('.badge')).toBeVisible();
});`;
    const patchedSource = `import { test, expect } from '@playwright/test';
test('status', async ({ page }) => {
  await expect(page.locator('.badge')).toBeHidden();
});`;
    const origRecords = AssertionHasher.extractAssertionRecordsFromSource(origSource);
    const patchedRecords = AssertionHasher.extractAssertionRecordsFromSource(patchedSource);
    const postSet = new Set(patchedRecords.map((a) => JSON.stringify(a)));
    const preserved = origRecords.every((a) => postSet.has(JSON.stringify(a)));
    expect(preserved).toBe(false);
  });

  // INV-03: Change expected value -> Reject
  it('INV-03: should reject patch that changes expected assertion value', async () => {
    const origSource = `import { test, expect } from '@playwright/test';
test('price', async ({ page }) => {
  await expect(page.locator('.total')).toHaveText('$99.00');
});`;
    const patchedSource = `import { test, expect } from '@playwright/test';
test('price', async ({ page }) => {
  await expect(page.locator('.total')).toHaveText('$0.00');
});`;
    const hash1 = AssertionHasher.computeCompositeFingerprintFromSource(origSource);
    const hash2 = AssertionHasher.computeCompositeFingerprintFromSource(patchedSource);
    expect(hash1.assertionFingerprint).not.toBe(hash2.assertionFingerprint);
  });

  // INV-04: Modify variable-based input -> Reject
  it('INV-04: should reject patch that mutates variable-based action input', () => {
    const origSource = `await page.locator('#user').fill(username);`;
    const patchedSource = `await page.locator('#user').fill(password);`;
    const res = IntentValidator.validateInputDataIntegrity(origSource, patchedSource);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("Action payload mutated from 'username' to 'password'");
  });

  // INV-05: Remove all fill operations -> Reject
  it('INV-05: should reject patch that removes all input fill operations', () => {
    const origSource = `await page.locator('#user').fill('admin'); await page.locator('#btn').click();`;
    const patchedSource = `await page.locator('#btn').click();`;
    const res = IntentValidator.validateInputDataIntegrity(origSource, patchedSource);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Input action count changed from 1 to 0');
  });

  // INV-06: Inject an additional business action -> Reject
  it('INV-06: should reject patch that injects an unauthorized business action', () => {
    const origSource = `await page.locator('#item').click();`;
    const patchedSource = `await page.locator('#item').click(); await page.locator('#coupon').click();`;
    const res = IntentValidator.validateWorkflowStepIntegrity(origSource, patchedSource);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Test step count changed from 1 to 2');
  });

  // INV-07: Reorder workflow actions -> Reject
  it('INV-07: should reject patch that reorders workflow actions', () => {
    const origSource = `await page.locator('#user').fill('alice'); await page.locator('#submit').click();`;
    const patchedSource = `await page.locator('#submit').click(); await page.locator('#user').fill('alice');`;
    const res = IntentValidator.validateWorkflowStepIntegrity(origSource, patchedSource);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain('Action sequence altered at step 1');
    expect(res.reason).toContain("expected 'fill', found 'click'");
  });

  // INV-08: Change && to || in business logic -> Reject
  it('INV-08: should detect operator change from && to || in test body structure', async () => {
    const origSource = `test('cond', () => { const valid = isReady && hasAccess; });`;
    const patchedSource = `test('cond', () => { const valid = isReady || hasAccess; });`;
    const hash1 = AssertionHasher.computeCompositeFingerprintFromSource(origSource);
    const hash2 = AssertionHasher.computeCompositeFingerprintFromSource(patchedSource);
    expect(hash1.testBodyFingerprint).not.toBe(hash2.testBodyFingerprint);
  });

  // INV-09: Aliased Playwright expect -> Detect and protect
  it('INV-09: should detect and protect aliased Playwright assertions', () => {
    const source = `import { test, expect as verify } from '@playwright/test';
test('aliased', async ({ page }) => {
  await verify(page.locator('.msg')).toHaveText('Done');
});`;
    const records = AssertionHasher.extractAssertionRecordsFromSource(source);
    expect(records.length).toBe(1);
    expect(records[0].arguments[0].value).toBe('Done');
  });

  // INV-10: expect.soft -> Detect and protect
  it('INV-10: should detect and protect expect.soft assertions', () => {
    const source = `import { test, expect } from '@playwright/test';
test('soft', async ({ page }) => {
  await expect.soft(page.locator('.item')).toBeVisible();
});`;
    const records = AssertionHasher.extractAssertionRecordsFromSource(source);
    expect(records.length).toBe(1);
    expect(records[0].expression).toContain('expect.soft');
  });

  // INV-11: expect.poll -> Detect and protect
  it('INV-11: should detect and protect expect.poll assertions', () => {
    const source = `import { test, expect } from '@playwright/test';
test('poll', async ({ page }) => {
  await expect.poll(async () => page.locator('.status').innerText()).toBe('ready');
});`;
    const records = AssertionHasher.extractAssertionRecordsFromSource(source);
    expect(records.length).toBe(1);
    expect(records[0].expression).toContain('expect.poll');
  });

  // INV-12: Duplicate targets on the same line -> Abstain
  it('INV-12: should strictly abstain when multiple matching statements exist on same line without disambiguation', () => {
    const source = `test('line', async ({ page }) => {
  await page.click('#a'); await page.click('#b');
});`;
    const patcher = new StatementPatcher();
    expect(() => {
      patcher.patchStatementInMemory(source, {
        kind: 'wrap-action-with-response',
        targetLine: 2,
        responsePredicate: 'resp => resp.status() === 200',
      });
    }).toThrow(AbstentionError);
  });

  // INV-13: Modify an unrelated statement -> Reject
  it('INV-13: should reject diff that modifies an unrelated statement or function', () => {
    const origSource = `import { test, expect } from '@playwright/test';
test('t', async ({ page }) => { await page.click('#btn'); });`;
    const patchedSource = `import { test, expect } from '@playwright/test';
function rogue() { return 42; }
test('t', async ({ page }) => { await page.click('#btn'); });`;
    const res = StatementDiffAllowlistValidator.validate({
      originalSource: origSource,
      patchedSource,
    });
    expect(res.isAllowed).toBe(false);
    expect(res.reason).toContain('Top-level function declarations modified or added');
  });

  // INV-14: Modify a comment only -> Permit if semantically irrelevant
  it('INV-14: should permit modifying comments while keeping AST structure identical', () => {
    const origSource = `// Old comment\nconst x = 1;`;
    const patchedSource = `// Updated documentation\nconst x = 1;`;
    const hash1 = AssertionHasher.computeCompositeFingerprintFromSource(origSource);
    const hash2 = AssertionHasher.computeCompositeFingerprintFromSource(patchedSource);
    expect(hash1.compositeHash).toBe(hash2.compositeHash);
  });

  // INV-15: Formatting-only change -> Permit
  it('INV-15: should permit formatting-only whitespace changes without tripping invariants', () => {
    const origSource = `const user = { name: 'Alice', age: 30 };`;
    const patchedSource = `const user = {\n  name: 'Alice',\n  age: 30,\n};`;
    const hash1 = AssertionHasher.computeCompositeFingerprintFromSource(origSource);
    const hash2 = AssertionHasher.computeCompositeFingerprintFromSource(patchedSource);
    expect(hash1.fixtureFingerprint).toBe(hash2.fixtureFingerprint);
  });

  // INV-16: Evidence-grounded locator replacement -> Permit if all invariants pass
  it('INV-16: should permit evidence-grounded locator replacement matching approved grammar', () => {
    const validExpr = "this.page.getByRole('button', { name: 'Submit' })";
    const check = DiffAllowlistValidator.validateLocatorGrammar(validExpr);
    expect(check.isValid).toBe(true);
  });

  // INV-17: Change Add to Cart into Delete Account -> Reject
  it('INV-17: should reject substituting Add to Cart action with Delete Account candidate', () => {
    const candidate: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Delete Account',
      attributes: {},
      text: 'Delete Account',
      children: [],
    };
    const res = IntentValidator.verifyTargetIdentity('button:has-text("Add to Cart")', candidate);
    expect(res.isPreserved).toBe(false);
    expect(res.reason).toContain('contradictory cancellation semantics');
  });

  // INV-18: Unsupported network predicate -> Abstain
  it('INV-18: should reject/abstain on statement patch that causes syntax errors in response predicates', () => {
    const source = `import { test } from '@playwright/test';
test('net', async ({ page }) => {
  await page.click('#submit');
});`;
    const patcher = new StatementPatcher();
    expect(() => {
      patcher.patchStatementInMemory(source, {
        kind: 'wrap-action-with-response',
        responsePredicate: 'resp => resp.url( === malformed', // broken syntax
      });
    }).toThrow(AbstentionError);
  });

  // INV-19: Readiness condition with no evidence -> Abstain
  it('INV-19: should abstain when statement target cannot be located in source', () => {
    const source = `import { test } from '@playwright/test';
test('unmatched', async ({ page }) => {
  await page.click('#existing');
});`;
    const patcher = new StatementPatcher();
    expect(() => {
      patcher.patchStatementInMemory(source, {
        kind: 'insert-readiness-check',
        targetActionSubstring: '#non-existent-action',
        readinessStatement: "await expect(page.locator('#ready')).toBeVisible();",
      });
    }).toThrow(AbstentionError);
  });

  // INV-20: Legitimate synchronization repair -> Complete end-to-end verification
  it('INV-20: should complete full verification pipeline for legitimate synchronization repair', async () => {
    const specContent = `import { test, expect } from '@playwright/test';
test('sync repair', async ({ page }) => {
  await page.goto('/items');
  await page.waitForTimeout(1000);
  await page.locator('#item-1').click();
  await expect(page.locator('.detail')).toBeVisible();
});`;
    const specPath = path.join(tmpDir, 'sync.spec.ts');
    await fs.writeFile(specPath, specContent, 'utf8');

    const proposal = RepairPlanner.planStatementRepair({
      originalActionId: 'call@sleep',
      originalSelector: 'await page.waitForTimeout(1000);',
      testFilePath: specPath,
      plan: {
        kind: 'replace-timeout-with-wait',
        replacementWaitStatement: "await expect(page.locator('#items-ready')).toBeVisible({ timeout: 5000 });",
      },
    });

    vi.spyOn(ExecutionRunner, 'run').mockResolvedValue({
      exitCode: 0,
      stdout: '1 passed',
      stderr: '',
      durationMs: 900,
      timedOut: false,
      truncated: false,
    });

    const result = await RepairPlanner.executeAndVerifyInWorktree({
      proposal,
      worktreePath: tmpDir,
      worktreeId: 'wt-inv-20',
      workspaceRoot: tmpDir,
    });

    expect(result.state).toBe('READY_FOR_APPROVAL');
    expect(result.isReadyForApproval).toBe(true);
    expect(result.intentValidation.isValid).toBe(true);
    expect(result.executionProof.assertionIntegrityValid).toBe(true);
    expect(result.evidence.repairedSuccessfully).toBe(true);
  });
});
