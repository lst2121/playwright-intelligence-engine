import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StatementDiffAllowlistValidator } from '../../src/repair/diff-allowlist.js';
import { IntentValidator, VerifiedExecutionProof } from '../../src/repair/intent-validator.js';
import { AssertionHasher } from '../../src/repair/assertion-hasher.js';
import { StatementPatcher } from '../../src/repair/statement-patcher.js';
import { RepairPlanner } from '../../src/repair/repair-planner.js';
import { ExecutionRunner } from '../../src/sandbox/execution-runner.js';
import { AssertionTamperedError, AbstentionError } from '../../src/core/errors/engine-errors.js';

describe('Statement Repair Invariant Contract & Worktree Verification Suite', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-stmt-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // 1. StatementDiffAllowlistValidator
  describe('StatementDiffAllowlistValidator', () => {
    const origSource = `
import { test, expect } from '@playwright/test';

test('search workflow', async ({ page }) => {
  await page.goto('/search');
  await page.waitForTimeout(1000);
  await page.locator('#query').fill('test');
  await page.locator('#btn-search').click();
  await expect(page.locator('.results')).toBeVisible();
});
`;

    it('allows replacing arbitrary sleep with event-driven wait', () => {
      const patchedSource = origSource.replace(
        'await page.waitForTimeout(1000);',
        "await expect(page.locator('#search-indicator')).toBeVisible({ timeout: 5000 });"
      );
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
        operation: 'replace-timeout-with-wait',
      });
      expect(res.isAllowed).toBe(true);
    });

    it('allows wrapping an action with page.waitForResponse inside Promise.all', () => {
      const patchedSource = origSource.replace(
        'await page.locator(\'#btn-search\').click();',
        "await Promise.all([\n  page.waitForResponse(resp => resp.url().includes('/api/search') && resp.status() === 200),\n  page.locator('#btn-search').click(),\n]);"
      );
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
        operation: 'wrap-action-with-response',
      });
      expect(res.isAllowed).toBe(true);
    });

    it('allows inserting a readiness check before an action', () => {
      const patchedSource = origSource.replace(
        'await page.locator(\'#btn-search\').click();',
        "await expect(page.locator('#btn-search')).toBeEnabled();\n  await page.locator('#btn-search').click();"
      );
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
        operation: 'insert-readiness-check',
      });
      expect(res.isAllowed).toBe(true);
    });

    it('strictly rejects prohibited security tokens (e.g. process.exit, require, eval)', () => {
      const patchedSource = origSource.replace(
        'await page.waitForTimeout(1000);',
        "process.exit(1);"
      );
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
      });
      expect(res.isAllowed).toBe(false);
      expect(res.reason).toContain("Prohibited security token 'process.exit' introduced");
    });

    it('strictly rejects unauthorized third-party module imports', () => {
      const patchedSource = `import axios from 'axios';\n` + origSource;
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
      });
      expect(res.isAllowed).toBe(false);
      expect(res.reason).toContain("Unauthorized new import of module 'axios'");
    });

    it('strictly rejects altering top-level function declarations', () => {
      const patchedSource = origSource + `\nfunction helper() { return 42; }\n`;
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
      });
      expect(res.isAllowed).toBe(false);
      expect(res.reason).toContain('Top-level function declarations modified or added');
    });

    it('strictly rejects modifying test names or test suite structure', () => {
      const patchedSource = origSource.replace(
        "test('search workflow'",
        "test('tampered test name'"
      );
      const res = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource,
      });
      expect(res.isAllowed).toBe(false);
      expect(res.reason).toContain('Test suite structure, test names, or test block declarations altered');
    });
  });

  // 2. IntentValidator.validateV2 with Statement Repair Invariant Contract
  describe('IntentValidator.validateV2 for statement-patch proposals', () => {
    it('approves a legitimate statement repair with verified execution proof', async () => {
      const origSpec = `
import { test, expect } from '@playwright/test';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  await page.waitForTimeout(1000);
  await page.locator('#qty').fill('2');
  await page.locator('#pay-btn').click();
  await expect(page.locator('.order-id')).toHaveText('ORDER-1234');
});
`;
      const specPath = path.join(tmpDir, 'checkout.spec.ts');
      await fs.writeFile(specPath, origSpec, 'utf8');

      const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);

      // Statement repair: replaces waitForTimeout with readiness check
      const patchedSpec = origSpec.replace(
        'await page.waitForTimeout(1000);',
        "await expect(page.locator('#checkout-form')).toBeVisible({ timeout: 5000 });"
      );

      const fakeProof: VerifiedExecutionProof = {
        worktreeId: 'wt-stmt-1',
        testFilePath: specPath,
        command: 'npx playwright test',
        exitCode: 0,
        stdout: '1 passed',
        stderr: '',
        passed: true,
        executionOutcome: 'PASS',
        durationMs: 450,
        assertionIntegrityValid: true,
        timestamp: Date.now(),
      };

      const result = IntentValidator.validateV2({
        testFilePath: specPath,
        originalCompositeFingerprint: origComposite,
        pageObjectOriginalSource: origSpec,
        pageObjectPatchedSource: patchedSpec,
        pageObjectClassName: 'InlineSpec',
        targetMemberName: 'replace-timeout-with-wait',
        candidateElement: {
          tag: 'statement',
          attributes: {},
          text: '',
          children: [],
        },
        intendedAction: 'replace-timeout-with-wait',
        executionProof: fakeProof,
        executionPassed: true,
        pattern: 'statement-patch',
      });

      expect(result.isValid).toBe(true);
      expect(result.assertionsPreserved).toBe(true);
      expect(result.diffAllowlistPassed).toBe(true);
      expect(result.executionVerified).toBe(true);
      expect(result.summary).toContain('Statement Repair Intent Invariant v2 satisfied');
    });

    it('strictly throws AssertionTamperedError when an original business assertion is deleted', async () => {
      const origSpec = `
import { test, expect } from '@playwright/test';

test('login', async ({ page }) => {
  await page.locator('#user').fill('admin');
  await page.locator('#btn').click();
  await expect(page.locator('.dashboard')).toBeVisible();
});
`;
      const specPath = path.join(tmpDir, 'login.spec.ts');
      await fs.writeFile(specPath, origSpec, 'utf8');
      const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);

      // Malicious repair: deletes the business assertion
      const patchedSpec = `
import { test, expect } from '@playwright/test';

test('login', async ({ page }) => {
  await page.locator('#user').fill('admin');
  await page.locator('#btn').click();
});
`;

      expect(() => {
        IntentValidator.validateV2({
          testFilePath: specPath,
          originalCompositeFingerprint: origComposite,
          pageObjectOriginalSource: origSpec,
          pageObjectPatchedSource: patchedSpec,
          candidateElement: { tag: 'statement', attributes: {}, text: '', children: [] },
          intendedAction: 'replace-statement',
          pattern: 'statement-patch',
        });
      }).toThrow(AssertionTamperedError);
    });

    it('strictly rejects when input data is mutated (e.g. changing credentials or quantities)', async () => {
      const origSpec = `
import { test, expect } from '@playwright/test';

test('login', async ({ page }) => {
  await page.locator('#user').fill('admin');
  await page.locator('#btn').click();
  await expect(page.locator('.dashboard')).toBeVisible();
});
`;
      const specPath = path.join(tmpDir, 'login.spec.ts');
      await fs.writeFile(specPath, origSpec, 'utf8');
      const origComposite = AssertionHasher.computeCompositeFingerprint(specPath);

      // Mutates input data 'admin' -> 'hacker'
      const patchedSpec = origSpec.replace("fill('admin')", "fill('hacker')");

      const result = IntentValidator.validateV2({
        testFilePath: specPath,
        originalCompositeFingerprint: origComposite,
        pageObjectOriginalSource: origSpec,
        pageObjectPatchedSource: patchedSpec,
        candidateElement: { tag: 'statement', attributes: {}, text: '', children: [] },
        intendedAction: 'replace-inline-locator',
        pattern: 'statement-patch',
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("Action payload mutated from 'admin' to 'hacker'");
    });

    it('strictly detects and rejects variable-based input data tampering (username -> password)', async () => {
      const origSpec = `
import { test, expect } from '@playwright/test';

test('auth', async ({ page }) => {
  const username = 'testuser';
  const password = 'secretpassword';
  await page.locator('#user').fill(username);
  await page.locator('#pass').fill(password);
  await expect(page).toHaveTitle('Welcome');
});
`;
      const specPath = path.join(tmpDir, 'auth.spec.ts');
      await fs.writeFile(specPath, origSpec, 'utf8');

      // Tampered: user filled with password instead of username
      const patchedSpec = origSpec.replace('fill(username)', 'fill(password)');

      const inputCheck = IntentValidator.validateInputDataIntegrity(origSpec, patchedSpec);
      expect(inputCheck.isValid).toBe(false);
      expect(inputCheck.reason).toContain("Action payload mutated from 'username' to 'password'");
    });

    it('strictly rejects when workflow action sequence is reordered or skipped', async () => {
      const origSpec = `
import { test, expect } from '@playwright/test';

test('wizard', async ({ page }) => {
  await page.locator('#step1-btn').click();
  await page.locator('#step2-btn').click();
  await expect(page.locator('.done')).toBeVisible();
});
`;
      // Tampered: skips step 1
      const patchedSpec = `
import { test, expect } from '@playwright/test';

test('wizard', async ({ page }) => {
  await page.locator('#step2-btn').click();
  await expect(page.locator('.done')).toBeVisible();
});
`;
      const check = IntentValidator.validateWorkflowStepIntegrity(origSpec, patchedSpec);
      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('Workflow sequence invariant violated: Test step count changed from 2 to 1');
    });
  });

  // 3. End-to-End Worktree Integration: RepairPlanner.executeAndVerifyInWorktree for statement repairs
  describe('RepairPlanner.executeAndVerifyInWorktree statement repair execution path', () => {
    it('executes end-to-end worktree verification of a statement repair and promotes to READY_FOR_APPROVAL', async () => {
      const specContent = `import { test, expect } from '@playwright/test';

test('item search', async ({ page }) => {
  await page.goto('/catalog');
  await page.waitForTimeout(1000);
  await page.locator('#search').fill('laptop');
  await page.locator('#submit').click();
  await expect(page.locator('.results')).toBeVisible();
});
`;
      const specPath = path.join(tmpDir, 'search.spec.ts');
      await fs.writeFile(specPath, specContent, 'utf8');

      // 1. Plan statement repair
      const proposal = RepairPlanner.planStatementRepair({
        originalActionId: 'call@sleep',
        originalSelector: 'await page.waitForTimeout(1000);',
        testFilePath: specPath,
        plan: {
          kind: 'replace-timeout-with-wait',
          replacementWaitStatement: "await expect(page.locator('#search-indicator')).toBeVisible({ timeout: 5000 });",
        },
      });

      expect(proposal.pattern).toBe('statement-patch');
      expect(proposal.diffAllowlistPassed).toBe(true);

      // 2. Mock ExecutionRunner to simulate Playwright execution inside worktree
      vi.spyOn(ExecutionRunner, 'run').mockResolvedValue({
        exitCode: 0,
        stdout: '1 passed (1.2s)',
        stderr: '',
        durationMs: 1200,
        timedOut: false,
        truncated: false,
      });

      // 3. Execute and verify inside worktree
      const verifiedResult = await RepairPlanner.executeAndVerifyInWorktree({
        proposal,
        worktreePath: tmpDir,
        worktreeId: 'worktree-stmt-verify-test',
        workspaceRoot: tmpDir,
      });

      // 4. Assert full verification and promotion
      expect(verifiedResult.state).toBe('READY_FOR_APPROVAL');
      expect(verifiedResult.isReadyForApproval).toBe(true);
      expect(verifiedResult.intentValidation.isValid).toBe(true);
      expect(verifiedResult.intentValidation.diffAllowlistPassed).toBe(true);
      expect(verifiedResult.intentValidation.executionVerified).toBe(true);
      expect(verifiedResult.executionProof.passed).toBe(true);
      expect(verifiedResult.executionProof.assertionIntegrityValid).toBe(true);
      expect(verifiedResult.evidence.repairedSuccessfully).toBe(true);
    });
  });

  // 4. Assertion Protection Hardening: Aliased imports & Outermost calls
  describe('Assertion Protection Hardening', () => {
    it('detects aliased assertion imports (e.g. import { expect as verify } from "@playwright/test")', async () => {
      const spec1 = path.join(tmpDir, 'alias1.spec.ts');
      const spec2 = path.join(tmpDir, 'alias2.spec.ts');

      await fs.writeFile(
        spec1,
        `import { test, expect as verify } from '@playwright/test';
test('alias', async ({ page }) => {
  await verify(page.locator('.status')).toHaveText('ACTIVE');
});`
      );

      await fs.writeFile(
        spec2,
        `import { test, expect as verify } from '@playwright/test';
test('alias', async ({ page }) => {
  await verify(page.locator('.status')).toHaveText('INACTIVE');
});`
      );

      const hash1 = AssertionHasher.computeAssertionFingerprint(spec1);
      const hash2 = AssertionHasher.computeAssertionFingerprint(spec2);

      expect(hash1).not.toBe(hash2);

      const records = AssertionHasher.extractAssertionRecordsFromSource(
        `import { test, expect as verify } from '@playwright/test';
test('alias', async ({ page }) => {
  await verify(page.locator('.status')).toHaveText('ACTIVE');
});`
      );

      expect(records.length).toBe(1);
      expect(records[0].arguments[0].value).toBe('ACTIVE');
    });

    it('canonicalizes chained assertions as exactly 1 assertion record', () => {
      const source = `
import { test, expect } from '@playwright/test';
test('chain', async ({ page }) => {
  await expect(page.locator('#btn')).toBeVisible();
  expect(response.status()).toBe(200);
  await expect.soft(page.locator('#badge')).toHaveText('New');
});
`;
      const records = AssertionHasher.extractAssertionRecordsFromSource(source);
      // Exactly 3 assertions, not duplicate inner calls
      expect(records.length).toBe(3);
    });

    it('strictly prevents StatementPatcher from altering or removing aliased assertions', () => {
      const source = `
import { test, expect as verify } from '@playwright/test';
test('alias protection', async ({ page }) => {
  await verify(page.locator('.status')).toHaveText('ACTIVE');
});
`;
      const patcher = new StatementPatcher();
      expect(() => {
        patcher.patchStatementInMemory(source, {
          kind: 'replace-statement',
          targetSubstring: 'verify',
          newStatement: 'console.log("bypassed");',
        });
      }).toThrow(AbstentionError);
    });
  });

  // 5. StatementPatcher Same-Line Disambiguation
  describe('StatementPatcher Disambiguation', () => {
    it('strictly abstains when multiple matching statements exist on the same line without unique disambiguation', () => {
      const source = `import { test } from '@playwright/test';
test('same line', async ({ page }) => {
  await page.click('#btn-a'); await page.click('#btn-b');
});`;
      const patcher = new StatementPatcher();

      expect(() => {
        patcher.patchStatementInMemory(source, {
          kind: 'wrap-action-with-response',
          targetLine: 3,
          responsePredicate: 'resp => resp.status() === 200',
        });
      }).toThrow(AbstentionError);
    });

    it('disambiguates multiple statements on the same line when targetActionSubstring is provided', () => {
      const source = `import { test } from '@playwright/test';
test('same line', async ({ page }) => {
  await page.click('#btn-a'); await page.click('#btn-b');
});`;
      const patcher = new StatementPatcher();

      const result = patcher.patchStatementInMemory(source, {
        kind: 'wrap-action-with-response',
        targetLine: 3,
        targetActionSubstring: '#btn-b',
        responsePredicate: 'resp => resp.status() === 200',
      });

      expect(result.success).toBe(true);
      expect(result.patchedSource).toContain('#btn-a');
      expect(result.patchedSource).toContain('waitForResponse');
    });
  });
});
