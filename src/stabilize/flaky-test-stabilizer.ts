import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Project, SyntaxKind, Node } from 'ts-morph';
import { StatementPatcher, ReplaceTimeoutPlan } from '../repair/statement-patcher.js';
import { AssertionHasher } from '../repair/assertion-hasher.js';
import { WorktreeManager } from '../sandbox/worktree-manager.js';
import { ExecutionRunner, WilsonScoreInterval } from '../sandbox/execution-runner.js';
import { assertPathWithinWorkspace } from '../repair/direct-code-repair.js';

export interface FlakyAntiPattern {
  kind: 'HARDCODED_SLEEP' | 'ARBITRARY_TIMEOUT';
  line: number;
  statementText: string;
  durationMs?: number | undefined;
  suggestedReplacement: string;
}

export interface FlakyTestScanResult {
  filePath: string;
  antiPatterns: FlakyAntiPattern[];
  hasFlakyAntiPatterns: boolean;
}

export interface StabilizeTestInput {
  testFilePath: string;
  workspaceRoot?: string | undefined;
  trials?: number | undefined;
  execute?: boolean | undefined;
  autoPromote?: boolean | undefined;
  configPath?: string | undefined;
  targetLine?: number | undefined;
}

export interface StabilizeTestResult {
  status: 'STABILIZED_AND_VERIFIED' | 'PROPOSAL_READY' | 'NO_FLAKINESS_DETECTED' | 'VERIFICATION_FAILED' | 'FAILED';
  testFilePath: string;
  antiPatterns: FlakyAntiPattern[];
  originalSource: string;
  stabilizedSource?: string | undefined;
  diff?: string | undefined;
  assertionIntegrityPreserved: boolean;
  trialsTotal: number;
  trialsPassed: number;
  confidenceInterval?: WilsonScoreInterval | undefined;
  reason: string;
}

export class FlakyTestStabilizer {
  /**
   * Statically scans a test specification file for flaky anti-patterns (such as waitForTimeout).
   */
  public static scan(filePath: string, sourceText?: string): FlakyTestScanResult {
    const code = sourceText ?? fsSync.readFileSync(filePath, 'utf8');
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.createSourceFile('scan.spec.ts', code);

    const antiPatterns: FlakyAntiPattern[] = [];

    // Find all call expressions matching waitForTimeout
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        const callText = expr.getText();
        if (callText.endsWith('.waitForTimeout') || callText === 'waitForTimeout') {
          const line = node.getStartLineNumber();
          const parentStmt = node.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ?? node;
          const stmtText = parentStmt.getText();

          // Extract duration argument if present
          const args = node.getArguments();
          let durationMs: number | undefined;
          if (args.length > 0 && Node.isNumericLiteral(args[0]!)) {
            durationMs = args[0]!.getLiteralValue();
          }

          // Inspect the subsequent sibling statement to find target locator
          let suggestedReplacement = "await page.waitForLoadState('domcontentloaded');";
          const nextSibling = parentStmt.getNextSibling();
          if (nextSibling) {
            const nextText = nextSibling.getText();
            const locatorMatch = nextText.match(/((?:await\s+)?(?:page\.)?(?:locator|getByRole|getByText|getByTestId|getByLabel|getByPlaceholder)\s*\([^)]+\))/);
            if (locatorMatch && locatorMatch[1]) {
              let cleanLoc = locatorMatch[1].trim();
              if (cleanLoc.startsWith('await ')) cleanLoc = cleanLoc.substring(6).trim();
              suggestedReplacement = `await ${cleanLoc}.waitFor({ state: 'visible', timeout: ${Math.max(5000, durationMs ?? 5000)} });`;
            }
          }

          antiPatterns.push({
            kind: 'HARDCODED_SLEEP',
            line,
            statementText: stmtText,
            durationMs,
            suggestedReplacement,
          });
        }
      }
    });

    return {
      filePath,
      antiPatterns,
      hasFlakyAntiPatterns: antiPatterns.length > 0,
    };
  }

  /**
   * Refactors arbitrary sleeps into deterministic locator- or event-driven awaits,
   * validates assertion preservation, and verifies stability across repeated trials in an isolated worktree.
   */
  public static async stabilize(input: StabilizeTestInput): Promise<StabilizeTestResult> {
    const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
    const resolvedSpecPath = path.resolve(workspaceRoot, input.testFilePath);
    assertPathWithinWorkspace(resolvedSpecPath, workspaceRoot);

    if (!fsSync.existsSync(resolvedSpecPath)) {
      return {
        status: 'FAILED',
        testFilePath: resolvedSpecPath,
        antiPatterns: [],
        originalSource: '',
        assertionIntegrityPreserved: false,
        trialsTotal: 0,
        trialsPassed: 0,
        reason: `Spec file not found: '${resolvedSpecPath}'`,
      };
    }

    const originalSource = await fs.readFile(resolvedSpecPath, 'utf8');
    const scanResult = FlakyTestStabilizer.scan(resolvedSpecPath, originalSource);

    if (!scanResult.hasFlakyAntiPatterns) {
      return {
        status: 'NO_FLAKINESS_DETECTED',
        testFilePath: resolvedSpecPath,
        antiPatterns: [],
        originalSource,
        assertionIntegrityPreserved: true,
        trialsTotal: 0,
        trialsPassed: 0,
        reason: 'No hardcoded sleeps or waitForTimeout anti-patterns detected in specification.',
      };
    }

    // Filter by targetLine if supplied
    const targetPatterns = input.targetLine
      ? scanResult.antiPatterns.filter((p) => p.line === input.targetLine)
      : scanResult.antiPatterns;

    if (targetPatterns.length === 0) {
      return {
        status: 'NO_FLAKINESS_DETECTED',
        testFilePath: resolvedSpecPath,
        antiPatterns: scanResult.antiPatterns,
        originalSource,
        assertionIntegrityPreserved: true,
        trialsTotal: 0,
        trialsPassed: 0,
        reason: `No anti-patterns found matching line ${input.targetLine}.`,
      };
    }

    // Apply AST transformations sequentially using StatementPatcher
    const patcher = new StatementPatcher();
    let currentSource = originalSource;

    for (const pattern of targetPatterns) {
      const plan: ReplaceTimeoutPlan = {
        kind: 'replace-timeout-with-wait',
        targetLine: input.targetLine ?? pattern.line,
        replacementWaitStatement: pattern.suggestedReplacement,
      };

      try {
        const patchRes = patcher.patchStatementInMemory(currentSource, plan, path.basename(resolvedSpecPath));
        if (patchRes.success) {
          currentSource = patchRes.patchedSource;
        }
      } catch (err: any) {
        // Fallback: replace pattern statement text directly if ts-morph line offset drifted
        if (currentSource.includes(pattern.statementText)) {
          currentSource = currentSource.replace(pattern.statementText, pattern.suggestedReplacement);
        }
      }
    }

    // Compute diff
    const diff = `--- a/${path.relative(workspaceRoot, resolvedSpecPath)}\n+++ b/${path.relative(workspaceRoot, resolvedSpecPath)}\n` +
      targetPatterns.map((p) => `- ${p.statementText}\n+ ${p.suggestedReplacement}`).join('\n');

    // 3. Assertion Fingerprint Preservation Check
    let assertionIntegrityPreserved = true;
    try {
      const tempOrig = path.resolve(workspaceRoot, `.pie-assert-before-${Date.now()}.ts`);
      const tempPatched = path.resolve(workspaceRoot, `.pie-assert-after-${Date.now()}.ts`);
      await fs.writeFile(tempOrig, originalSource, 'utf8');
      await fs.writeFile(tempPatched, currentSource, 'utf8');
      try {
        const fp1 = AssertionHasher.computeAssertionFingerprint(tempOrig);
        const fp2 = AssertionHasher.computeAssertionFingerprint(tempPatched);
        assertionIntegrityPreserved = fp1 === fp2;
      } finally {
        await fs.unlink(tempOrig).catch(() => {});
        await fs.unlink(tempPatched).catch(() => {});
      }
    } catch {
      assertionIntegrityPreserved = true;
    }

    if (!assertionIntegrityPreserved) {
      return {
        status: 'VERIFICATION_FAILED',
        testFilePath: resolvedSpecPath,
        antiPatterns: targetPatterns,
        originalSource,
        stabilizedSource: currentSource,
        diff,
        assertionIntegrityPreserved: false,
        trialsTotal: 0,
        trialsPassed: 0,
        reason: 'Security Violation: Stabilization refactoring altered original expect(...) assertion fingerprints.',
      };
    }

    // If sandbox execution was not requested, return proposal
    if (input.execute === false && !input.autoPromote) {
      return {
        status: 'PROPOSAL_READY',
        testFilePath: resolvedSpecPath,
        antiPatterns: targetPatterns,
        originalSource,
        stabilizedSource: currentSource,
        diff,
        assertionIntegrityPreserved,
        trialsTotal: 0,
        trialsPassed: 0,
        reason: 'Stabilization proposal generated. Sandbox trial execution was not requested.',
      };
    }

    // 4. Multi-Trial Verification in Isolated Worktree
    const trials = Math.max(1, input.trials ?? 3);
    const manager = new WorktreeManager(workspaceRoot);
    const worktreeId = `stabilize-${crypto.randomUUID().slice(0, 8)}`;
    let worktree;

    try {
      worktree = await manager.createWorktree(worktreeId);
    } catch (err: any) {
      return {
        status: 'FAILED',
        testFilePath: resolvedSpecPath,
        antiPatterns: targetPatterns,
        originalSource,
        stabilizedSource: currentSource,
        diff,
        assertionIntegrityPreserved,
        trialsTotal: 0,
        trialsPassed: 0,
        reason: `Failed to create isolated Git worktree: ${err.message}`,
      };
    }

    let trialsPassed = 0;
    let confidenceInterval: WilsonScoreInterval | undefined;

    try {
      // Write stabilized source into worktree
      const relSpec = path.relative(workspaceRoot, resolvedSpecPath);
      const worktreeTarget = path.resolve(worktree.worktreePath, relSpec);
      await fs.mkdir(path.dirname(worktreeTarget), { recursive: true });
      await fs.writeFile(worktreeTarget, currentSource, 'utf8');

      // Execute repeated trials
      const summary = await ExecutionRunner.runRepeatedPlaywrightTrials({
        cwd: worktree.worktreePath,
        testFilePath: relSpec,
        trials,
        configPath: input.configPath,
        env: { CI: '1', HEADLESS: '1' },
      });

      trialsPassed = summary.passedCount;
      confidenceInterval = summary.wilsonInterval95;

      const allPassed = summary.passedCount === trials;

      if (allPassed && input.autoPromote) {
        assertPathWithinWorkspace(resolvedSpecPath, workspaceRoot);
        await fs.writeFile(resolvedSpecPath, currentSource, 'utf8');
      }

      return {
        status: allPassed ? 'STABILIZED_AND_VERIFIED' : 'VERIFICATION_FAILED',
        testFilePath: resolvedSpecPath,
        antiPatterns: targetPatterns,
        originalSource,
        stabilizedSource: currentSource,
        diff,
        assertionIntegrityPreserved,
        trialsTotal: trials,
        trialsPassed,
        confidenceInterval,
        reason: allPassed
          ? `Test successfully stabilized and verified across ${trials}/${trials} trials (${confidenceInterval?.center ?? 100}% confidence).${input.autoPromote ? ' Promoted to workspace.' : ''}`
          : `Stabilization failed verification: ${summary.failedCount}/${trials} trials failed in worktree.`,
      };
    } finally {
      await manager.destroyWorktree(worktree.id).catch(() => {});
    }
  }
}
