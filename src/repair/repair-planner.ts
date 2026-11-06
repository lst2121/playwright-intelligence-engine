import fs from 'node:fs';
import path from 'node:path';
import { AstPatcher } from './ast-patcher.js';
import { AssertionHasher, CompositeIntentFingerprint } from './assertion-hasher.js';
import { IntentValidator, IntentV2ValidationResult, VerifiedExecutionProof } from './intent-validator.js';
import { DiffAllowlistValidator } from './diff-allowlist.js';
import { ApprovalService } from './approval-service.js';
import { RepairEvidence } from '../core/types/repair-evidence.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';
import { CandidateExtractor } from '../selector/candidate-extractor.js';
import { ExecutionRunner, ExecutionResult } from '../sandbox/execution-runner.js';
import { PROOF_VERSION } from '../core/version.js';
import {
  BusinessIntent,
  BusinessOracleResult,
  evaluateBuiltInBusinessOracles,
  extractBusinessIntent,
} from '../intelligence/business-intent.js';

export type RepairLifecycleState =
  | 'ANALYZED'
  | 'PROPOSED'
  | 'PATCHED_IN_ISOLATION'
  | 'INTENT_VALIDATED'
  | 'TARGET_TEST_PASSED'
  | 'AFFECTED_TESTS_PASSED'
  | 'FULL_SUITE_PASSED'
  | 'READY_FOR_APPROVAL'
  | 'REJECTED';

export interface RepairProposal {
  state: RepairLifecycleState;
  originalActionId: string;
  originalSelector: string;
  replacementSelector: string;
  candidateElement: ResolvedElement;
  candidateScore: number;
  testFilePath: string;
  pomFilePath: string;
  className: string;
  memberName: string;
  intendedAction: string;
  originalCompositeFingerprint: CompositeIntentFingerprint;
  proposedPatchedSource: string;
  originalSource: string;
  pattern: string;
  fullDiff?: string | undefined;
  diffAllowlistPassed: boolean;
  businessIntent?: BusinessIntent | undefined;
}

export interface RepairVerificationInput {
  proposal: RepairProposal;
  worktreePath: string;
  worktreeId: string;
  workspaceRoot?: string | undefined;
  configPath?: string | undefined;
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable' | undefined;
}

export interface VerifiedRepairResult {
  state: RepairLifecycleState;
  evidence: RepairEvidence;
  executionResult: ExecutionResult;
  intentValidation: IntentV2ValidationResult;
  executionProof: VerifiedExecutionProof;
  isReadyForApproval: boolean;
  businessOracleResults?: BusinessOracleResult[] | undefined;
}

export interface RepairPlanInput {
  originalActionId: string;
  originalSelector: string;
  candidateElement: ResolvedElement;
  candidateScore: number;
  testFilePath: string;
  pomFilePath: string;
  className: string;
  memberName: string;
  intendedAction: string;
  replacementSelector?: string | undefined;
  worktreeId?: string | undefined;
}

export class RepairPlanner {
  /**
   * Generates a modern, user-centric Playwright locator expression prioritizing getByRole and getByTestId.
   * Employs robust string escaping; avoids bare tag fallbacks.
   */
  public static generateSelectorExpression(el: ResolvedElement, pageProperty = 'this.page'): string {
    return CandidateExtractor.generateLocator(el, pageProperty);
  }

  /**
   * Stage 1 & 2: Analyzes candidate and generates an in-memory repair proposal.
   * Does NOT modify source files on disk. Does NOT claim repair success.
   */
  public static planRepair(input: RepairPlanInput): RepairProposal {
    // 0. Read original source and discover page property identifier
    const origSource = fs.readFileSync(input.pomFilePath, 'utf-8');
    const pageProperty = CandidateExtractor.discoverPageProperty(origSource);

    // 1. Synthesize replacement locator expression with escaping
    const replacementLocator = input.replacementSelector ?? RepairPlanner.generateSelectorExpression(input.candidateElement, pageProperty);

    // 2. Validate replacement against Playwright locator grammar
    const grammarCheck = DiffAllowlistValidator.validateLocatorGrammar(replacementLocator);
    if (!grammarCheck.isValid) {
      throw new Error(`Invalid candidate locator generated: ${grammarCheck.reason}`);
    }

    // 3. Compute baseline composite fingerprint of the test spec
    const originalCompositeFingerprint = AssertionHasher.computeCompositeFingerprint(input.testFilePath);

    // 4. Generate in-memory AST patch without writing to disk
    const patcher = new AstPatcher();
    const inMemPatch = patcher.patchPageObjectInMemory(origSource, {
      className: input.className,
      memberName: input.memberName,
      replacementExpression: replacementLocator,
    });

    // 5. Validate diff allowlist in-memory
    const diffResult = DiffAllowlistValidator.validate({
      originalSource: origSource,
      patchedSource: inMemPatch.patchedSource,
      targetClassName: input.className,
      targetMemberName: input.memberName,
    });

    if (!diffResult.isAllowed) {
      throw new Error(`Diff allowlist rejected proposed patch: ${diffResult.reason}`);
    }

    return {
      state: 'PROPOSED',
      originalActionId: input.originalActionId,
      originalSelector: input.originalSelector,
      replacementSelector: replacementLocator,
      candidateElement: input.candidateElement,
      candidateScore: input.candidateScore,
      testFilePath: input.testFilePath,
      pomFilePath: input.pomFilePath,
      className: input.className,
      memberName: input.memberName,
      intendedAction: input.intendedAction,
      originalCompositeFingerprint,
      proposedPatchedSource: inMemPatch.patchedSource,
      originalSource: origSource,
      pattern: inMemPatch.pattern,
      fullDiff: inMemPatch.diff,
      diffAllowlistPassed: true,
      businessIntent: extractBusinessIntent({
        id: input.originalActionId,
        sourceText: fs.readFileSync(input.testFilePath, 'utf8'),
        sourcePath: input.testFilePath,
      }),
    };
  }

  /**
   * Stages 3-8: Applies patch strictly inside the isolated Git worktree, runs test execution,
   * validates Intent Invariant v2 with actual execution proof, and derives verified evidence.
   */
  public static async executeAndVerifyInWorktree(
    input: RepairVerificationInput
  ): Promise<VerifiedRepairResult> {
    const proposal = input.proposal;
    const rootDir = input.workspaceRoot ?? process.cwd();

    // Canonical containment checks
    const canonicalWorktree = fs.existsSync(input.worktreePath)
      ? fs.realpathSync(input.worktreePath)
      : path.resolve(input.worktreePath);

    const relPom = path.isAbsolute(proposal.pomFilePath)
      ? path.relative(rootDir, proposal.pomFilePath)
      : proposal.pomFilePath;
    const relSpec = path.isAbsolute(proposal.testFilePath)
      ? path.relative(rootDir, proposal.testFilePath)
      : proposal.testFilePath;

    const worktreePomPath = path.resolve(canonicalWorktree, relPom);
    const worktreeSpecPath = path.resolve(canonicalWorktree, relSpec);

    const relPomCheck = path.relative(canonicalWorktree, worktreePomPath);
    if (relPomCheck.startsWith('..') || path.isAbsolute(relPomCheck)) {
      throw new Error(`Security Violation: Worktree POM path '${worktreePomPath}' escapes worktree boundary '${canonicalWorktree}'.`);
    }

    const relSpecCheck = path.relative(canonicalWorktree, worktreeSpecPath);
    if (relSpecCheck.startsWith('..') || path.isAbsolute(relSpecCheck)) {
      throw new Error(`Security Violation: Worktree Spec path '${worktreeSpecPath}' escapes worktree boundary '${canonicalWorktree}'.`);
    }

    // Stage 3: Apply patch ONLY in isolated worktree copy
    await fs.promises.mkdir(path.dirname(worktreePomPath), { recursive: true });
    await fs.promises.writeFile(worktreePomPath, proposal.proposedPatchedSource, 'utf-8');
    let currentState: RepairLifecycleState = 'PATCHED_IN_ISOLATION';

    // Stage 4: Execute target test inside worktree
    const execArgs = ['playwright', 'test', relSpec];
    if (input.configPath) {
      const relConfig = path.isAbsolute(input.configPath)
        ? path.relative(rootDir, input.configPath)
        : input.configPath;
      execArgs.push('--config', relConfig);
    }

    const execResult = await ExecutionRunner.run('npx', {
      cwd: canonicalWorktree,
      args: execArgs,
      timeoutMs: 60000,
    });

    // Verify test was actually discovered and passed
    const passedMatch = execResult.stdout.match(/(\d+)\s+passed/i);
    const passedCount = passedMatch ? parseInt(passedMatch[1] ?? '0', 10) : 0;
    const executionPassed = execResult.exitCode === 0 && passedCount > 0 && !execResult.timedOut;

    if (executionPassed) {
      currentState = 'TARGET_TEST_PASSED';
    }

    const executionProof: VerifiedExecutionProof = {
      testFilePath: worktreeSpecPath,
      targetTestIdentity: relSpec,
      command: `npx ${execArgs.join(' ')}`,
      worktreeId: input.worktreeId,
      repositoryIdentity: rootDir,
      originalSourceHash: ApprovalService.hashContent(proposal.originalSource),
      modifiedSourceHash: ApprovalService.hashContent(proposal.proposedPatchedSource),
      diffHash: ApprovalService.hashContent(proposal.proposedPatchedSource),
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      passed: executionPassed,
      executionOutcome: executionPassed ? 'PASS' : 'FAIL',
      durationMs: execResult.durationMs,
      targetTestEvidence: [`Passed tests: ${passedCount}`, `Exit code: ${execResult.exitCode}`],
      assertionIntegrityValid: true,
      timestamp: Date.now(),
      proofVersion: PROOF_VERSION,
    };

    // Missing source evidence remains unavailable; it must never be treated
    // as proof of business correctness.
    const originalSpecPath = path.isAbsolute(proposal.testFilePath)
      ? proposal.testFilePath
      : path.resolve(rootDir, proposal.testFilePath);
    const originalSpecSource = fs.existsSync(originalSpecPath)
      ? fs.readFileSync(originalSpecPath, 'utf-8')
      : undefined;
    const currentSpecSource = fs.existsSync(worktreeSpecPath)
      ? fs.readFileSync(worktreeSpecPath, 'utf-8')
      : undefined;
    const builtInOracleEvaluation = evaluateBuiltInBusinessOracles({
      intent: proposal.businessIntent ?? extractBusinessIntent({
        id: proposal.originalActionId,
        sourceText: originalSpecSource ?? '',
        sourcePath: originalSpecPath,
      }),
      originalSourceText: originalSpecSource,
      currentSourceText: currentSpecSource,
      executionPassed,
    });
    const effectiveBusinessOracleStatus = input.businessOracleStatus === 'contradicted'
      || builtInOracleEvaluation.status === 'contradicted'
      ? 'contradicted'
      : input.businessOracleStatus ?? builtInOracleEvaluation.status;

    // Stage 5: Validate Intent Invariant v2 with actual execution proof
    const intentValidation = IntentValidator.validateV2({
      testFilePath: worktreeSpecPath,
      originalCompositeFingerprint: proposal.originalCompositeFingerprint,
      pageObjectOriginalSource: proposal.originalSource,
      pageObjectPatchedSource: proposal.proposedPatchedSource,
      pageObjectClassName: proposal.className,
      targetMemberName: proposal.memberName,
      candidateElement: proposal.candidateElement,
      intendedAction: proposal.intendedAction,
      originalSelector: proposal.originalSelector,
      executionPassed,
      executionProof,
      businessOracleStatus: effectiveBusinessOracleStatus,
    });

    const isFullyVerified = executionPassed && intentValidation.isValid;
    currentState = isFullyVerified ? 'READY_FOR_APPROVAL' : 'REJECTED';

    const evidence: RepairEvidence = {
      originalActionId: proposal.originalActionId,
      originalSelector: proposal.originalSelector,
      candidateSelector: proposal.replacementSelector,
      candidateScore: proposal.candidateScore,
      sourceLocation: {
        filePath: proposal.pomFilePath,
        className: proposal.className,
        memberName: proposal.memberName,
        nodeKind: proposal.pattern === 'property-initializer' ? 'property' : (proposal.pattern as any),
        line: 1,
      },
      targetIdentityEvidence: [
        `Tag: ${proposal.candidateElement.tag}`,
        `Role: ${proposal.candidateElement.role ?? 'none'}`,
        `Name: ${proposal.candidateElement.accessibleName ?? 'none'}`,
      ],
      assertionFingerprint: proposal.originalCompositeFingerprint.assertionFingerprint,
      businessOracleStatus: effectiveBusinessOracleStatus,
      verificationWorktreeId: input.worktreeId,
      repairedTestDurationMs: execResult.durationMs,
      timestamp: Date.now(),
      repairedSuccessfully: isFullyVerified,
    };

    return {
      state: currentState,
      evidence,
      executionResult: execResult,
      intentValidation,
      executionProof,
      isReadyForApproval: isFullyVerified,
      businessOracleResults: builtInOracleEvaluation.results,
    };
  }

  /**
   * Backward-compatible planAndExecute wrapper.
   * Generates in-memory repair proposal and validates intent in-memory.
   * Strictly PROHIBITS direct disk mutation without isolated worktree execution.
   */
  public static planAndExecute(input: RepairPlanInput): RepairEvidence {
    const proposal = RepairPlanner.planRepair(input);

    // Validate Intent Invariant (assertion immutability & action semantics)
    const validation = IntentValidator.validateProposal({
      testFilePath: input.testFilePath,
      originalCompositeFingerprint: proposal.originalCompositeFingerprint,
      candidateElement: input.candidateElement,
      intendedAction: input.intendedAction,
      originalSelector: input.originalSelector,
      businessOracleStatus: 'unavailable',
    });

    if (!validation.isValid) {
      throw new Error(`Intent validation failed: ${validation.reason ?? 'Invalid action semantics or identity mismatch'}`);
    }

    return {
      originalActionId: input.originalActionId,
      originalSelector: input.originalSelector,
      candidateSelector: proposal.replacementSelector,
      candidateScore: input.candidateScore,
      sourceLocation: {
        filePath: input.pomFilePath,
        className: input.className,
        memberName: input.memberName,
        nodeKind: proposal.pattern === 'property-initializer' ? 'property' : (proposal.pattern as any),
        line: 1,
      },
      targetIdentityEvidence: [
        `Tag: ${input.candidateElement.tag}`,
        `Role: ${input.candidateElement.role ?? 'none'}`,
        `Name: ${input.candidateElement.accessibleName ?? 'none'}`,
      ],
      assertionFingerprint: proposal.originalCompositeFingerprint.assertionFingerprint,
      businessOracleStatus: 'unavailable',
      verificationWorktreeId: input.worktreeId ?? 'unverified-in-memory',
      repairedTestDurationMs: 0,
      timestamp: Date.now(),
      repairedSuccessfully: false, // Direct modification prohibited; requires isolated worktree execution
      notes: 'Direct disk mutation prohibited. Proposal generated in-memory. Use executeAndVerifyInWorktree() for isolated execution proof.',
    };
  }
}
