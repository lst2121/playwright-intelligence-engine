import { Project, Node } from 'ts-morph';
import { AssertionHasher, CompositeIntentFingerprint } from './assertion-hasher.js';
import { DiffAllowlistValidator, StatementDiffAllowlistValidator } from './diff-allowlist.js';
import {
  AssertionTamperedError,
  IntentInvariantViolationError,
  UnauthorizedAstModificationError,
} from '../core/errors/engine-errors.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';

export interface ValidationTarget {
  testFilePath: string;
  originalFingerprint: string;
  candidateElement: ResolvedElement;
  intendedAction: string; // e.g. "click", "fill"
  originalSelector?: string | undefined;
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable' | undefined;
}

export interface VerifiedExecutionProof {
  proposalId?: string | undefined;
  worktreeId: string;
  repositoryIdentity?: string | undefined;
  originalSourceHash?: string | undefined;
  modifiedSourceHash?: string | undefined;
  diffHash?: string | undefined;
  targetTestIdentity?: string | undefined;
  testFilePath: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  executionOutcome?: 'PASS' | 'FAIL' | undefined;
  durationMs: number;
  targetTestEvidence?: string[] | undefined;
  regressionEvidence?: string[] | undefined;
  assertionIntegrityValid?: boolean | undefined;
  timestamp: number;
  proofVersion?: string | undefined;
}

export interface PreflightProposalTarget {
  testFilePath: string;
  originalCompositeFingerprint: CompositeIntentFingerprint;
  candidateElement: ResolvedElement;
  intendedAction: string;
  originalSelector?: string | undefined;
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable' | undefined;
}

export interface PreflightProposalResult {
  isValid: boolean;
  assertionsPreserved: boolean; // A
  testBodyPreserved: boolean; // T
  fixturesPreserved: boolean; // F
  identityAndActionPreserved: boolean; // I
  summary: string;
  reason?: string | undefined;
}

export interface VerifiedAuthorizationTarget {
  testFilePath: string;
  originalCompositeFingerprint: CompositeIntentFingerprint;
  pageObjectOriginalSource: string;
  pageObjectPatchedSource: string;
  pageObjectClassName: string;
  targetMemberName: string;
  candidateElement: ResolvedElement;
  intendedAction: string;
  originalSelector?: string | undefined;
  executionProof: VerifiedExecutionProof;
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable' | undefined;
}

export interface VerifiedAuthorizationResult {
  isAuthorized: boolean;
  assertionsPreserved: boolean; // A
  testBodyPreserved: boolean; // T
  fixturesPreserved: boolean; // F
  identityAndActionPreserved: boolean; // I
  diffAllowlistPassed: boolean; // D
  executionVerified: boolean; // E
  summary: string;
  reason?: string | undefined;
}

export interface IntentV2ValidationTarget {
  testFilePath: string;
  originalCompositeFingerprint: CompositeIntentFingerprint;
  pageObjectOriginalSource?: string | undefined;
  pageObjectPatchedSource?: string | undefined;
  pageObjectClassName?: string | undefined;
  targetMemberName?: string | undefined;
  candidateElement: ResolvedElement;
  intendedAction: string;
  originalSelector?: string | undefined;
  executionPassed?: boolean | undefined;
  executionProof?: VerifiedExecutionProof | undefined;
  mode?: 'pre-flight' | 'authorization' | undefined;
  strict?: boolean | undefined;
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable' | undefined;
  pattern?: string | undefined;
}

export interface IntentValidationResult {
  isValid: boolean;
  assertionPreserved: boolean;
  actionSemanticsValid: boolean;
  identityPreserved: boolean;
  reason?: string | undefined;
}

export interface IntentV2ValidationResult {
  isValid: boolean;
  assertionsPreserved: boolean; // A
  testBodyPreserved: boolean; // T
  fixturesPreserved: boolean; // F
  identityAndActionPreserved: boolean; // I
  diffAllowlistPassed: boolean; // D
  executionVerified: boolean; // E
  reason?: string | undefined;
  summary: string;
}

export class IntentValidator {
  private static readonly CONFLICTING_ACTION_PAIRS = [
    {
      positive: ['submit', 'login', 'checkout', 'save', 'confirm', 'proceed', 'pay', 'order', 'continue', 'apply'],
      negative: ['cancel', 'close', 'reset', 'abort', 'back', 'dismiss', 'exit'],
    },
    {
      positive: ['create', 'add', 'insert', 'new', 'edit', 'update', 'modify'],
      negative: ['delete', 'remove', 'destroy', 'clear', 'purge'],
    },
  ];

  /**
   * Validates whether candidate element preserves genuine business identity
   * without substituting contradictory actions (e.g. replacing 'Submit' with 'Cancel').
   */
  public static verifyTargetIdentity(
    originalSelector: string | undefined,
    candidate: ResolvedElement
  ): { isPreserved: boolean; reason?: string } {
    if (!originalSelector) {
      return { isPreserved: true };
    }

    const origTokens = originalSelector.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
    const candidateText = [
      candidate.accessibleName ?? '',
      candidate.text ?? '',
      candidate.attributes['data-testid'] ?? '',
      candidate.attributes['aria-label'] ?? '',
      candidate.attributes['id'] ?? '',
    ].join(' ').toLowerCase();
    const candidateTokens = candidateText.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);

    // Hard Conflict Check: Reject substituting positive action with negative/cancellation action
    for (const pair of IntentValidator.CONFLICTING_ACTION_PAIRS) {
      const origHasPositive = pair.positive.some((p) => origTokens.includes(p));
      const candHasNegative = pair.negative.some((n) => candidateTokens.includes(n));
      if (origHasPositive && candHasNegative) {
        return {
          isPreserved: false,
          reason: `Identity violation: Target '${originalSelector}' appears to be a confirmation/submission action, but replacement candidate '${candidate.accessibleName ?? candidate.tag}' has contradictory cancellation semantics.`,
        };
      }

      const origHasNegative = pair.negative.some((n) => origTokens.includes(n));
      const candHasPositive = pair.positive.some((p) => candidateTokens.includes(p));
      if (origHasNegative && candHasPositive) {
        return {
          isPreserved: false,
          reason: `Identity violation: Target '${originalSelector}' appears to be a cancellation action, but replacement candidate '${candidate.accessibleName ?? candidate.tag}' has contradictory submission semantics.`,
        };
      }
    }

    // Destructive Action Invariant: A deletion/removal action must never be substituted by a non-destructive element
    const isDestructiveOriginal = ['delete', 'remove', 'destroy', 'purge'].some((t) => origTokens.includes(t));
    const isDestructiveCandidate = ['delete', 'remove', 'destroy', 'purge'].some((t) => candidateTokens.includes(t));
    if (isDestructiveOriginal && !isDestructiveCandidate) {
      return {
        isPreserved: false,
        reason: `Identity violation: Target '${originalSelector}' is a destructive action, but candidate '${candidate.accessibleName ?? candidate.tag}' lacks deletion/removal semantics.`,
      };
    }

    return { isPreserved: true };
  }

  /**
   * Backward-compatible validation for simple assertion and identity checks.
   */
  public static validate(target: ValidationTarget): IntentValidationResult {
    const postPatchFingerprint = AssertionHasher.computeFingerprint(target.testFilePath);
    if (postPatchFingerprint !== target.originalFingerprint) {
      throw new AssertionTamperedError(target.originalFingerprint, postPatchFingerprint);
    }

    const actionSemanticsValid = IntentValidator.checkActionSemantics(target.intendedAction, target.candidateElement);
    const identityCheck = IntentValidator.verifyTargetIdentity(target.originalSelector, target.candidateElement);

    return {
      isValid: actionSemanticsValid && identityCheck.isPreserved,
      assertionPreserved: true,
      actionSemanticsValid,
      identityPreserved: identityCheck.isPreserved,
      reason: identityCheck.reason,
    };
  }

  /**
   * Evaluates proposal pre-flight invariant: V_pre = A ∧ T ∧ F ∧ I
   * Used strictly for in-memory planning without claiming mutation authorization.
   */
  public static validateProposal(target: PreflightProposalTarget): PreflightProposalResult {
    const postPatch = AssertionHasher.computeCompositeFingerprint(target.testFilePath);

    const assertionsPreserved =
      postPatch.assertionFingerprint === target.originalCompositeFingerprint.assertionFingerprint;
    if (!assertionsPreserved) {
      throw new AssertionTamperedError(
        target.originalCompositeFingerprint.assertionFingerprint,
        postPatch.assertionFingerprint
      );
    }

    const testBodyPreserved =
      postPatch.testBodyFingerprint === target.originalCompositeFingerprint.testBodyFingerprint;
    if (!testBodyPreserved) {
      throw new IntentInvariantViolationError(
        'TestBodyStructure',
        'Test statement order, control flow, conditions, or test body AST nodes were modified.'
      );
    }

    const fixturesPreserved =
      postPatch.fixtureFingerprint === target.originalCompositeFingerprint.fixtureFingerprint;
    if (!fixturesPreserved) {
      throw new IntentInvariantViolationError(
        'FixtureParameters',
        'Test fixtures, input parameters, or literal values were altered or reordered.'
      );
    }

    const identityCheck = IntentValidator.verifyTargetIdentity(target.originalSelector, target.candidateElement);
    const actionSemanticsValid = IntentValidator.checkActionSemantics(target.intendedAction, target.candidateElement);
    const identityAndActionPreserved = actionSemanticsValid && identityCheck.isPreserved;

    if (target.businessOracleStatus === 'contradicted') {
      return {
        isValid: false,
        assertionsPreserved,
        testBodyPreserved,
        fixturesPreserved,
        identityAndActionPreserved: false,
        summary: 'Rejected: Independent business oracle contradicted target identity',
        reason: 'Business oracle contradicted the candidate identity',
      };
    }

    const isValid = assertionsPreserved && testBodyPreserved && fixturesPreserved && identityAndActionPreserved;

    return {
      isValid,
      assertionsPreserved,
      testBodyPreserved,
      fixturesPreserved,
      identityAndActionPreserved,
      summary: isValid
        ? 'Pre-flight Intent Invariant passed: V_pre = A ∧ T ∧ F ∧ I'
        : `Pre-flight Intent Invariant failed: ${identityCheck.reason ?? 'Action semantics invalid'}`,
      reason: identityCheck.reason,
    };
  }

  /**
   * Evaluates strict production authorization invariant: V = A ∧ T ∧ F ∧ I ∧ D ∧ E
   * Unconditionally fails closed if any evidence is missing or execution proof fails.
   */
  public static authorizeVerifiedRepair(target: VerifiedAuthorizationTarget): VerifiedAuthorizationResult {
    const preflight = IntentValidator.validateProposal({
      testFilePath: target.testFilePath,
      originalCompositeFingerprint: target.originalCompositeFingerprint,
      candidateElement: target.candidateElement,
      intendedAction: target.intendedAction,
      originalSelector: target.originalSelector,
      businessOracleStatus: target.businessOracleStatus,
    });

    if (!preflight.isValid) {
      return {
        isAuthorized: false,
        assertionsPreserved: preflight.assertionsPreserved,
        testBodyPreserved: preflight.testBodyPreserved,
        fixturesPreserved: preflight.fixturesPreserved,
        identityAndActionPreserved: preflight.identityAndActionPreserved,
        diffAllowlistPassed: false,
        executionVerified: false,
        summary: `Authorization Rejected: Pre-flight clauses failed (${preflight.summary})`,
        reason: preflight.reason,
      };
    }

    // 5. D: Diff Allowlist
    const diffResult = DiffAllowlistValidator.validate({
      originalSource: target.pageObjectOriginalSource,
      patchedSource: target.pageObjectPatchedSource,
      targetClassName: target.pageObjectClassName,
      targetMemberName: target.targetMemberName,
    });

    if (!diffResult.isAllowed) {
      throw new UnauthorizedAstModificationError(diffResult.reason ?? 'Unknown violation');
    }

    // 6. E: Execution Verification
    const proof = target.executionProof;
    if (!proof || !proof.passed || proof.exitCode !== 0) {
      return {
        isAuthorized: false,
        assertionsPreserved: preflight.assertionsPreserved,
        testBodyPreserved: preflight.testBodyPreserved,
        fixturesPreserved: preflight.fixturesPreserved,
        identityAndActionPreserved: preflight.identityAndActionPreserved,
        diffAllowlistPassed: true,
        executionVerified: false,
        summary: `Authorization Rejected: Target test execution did not pass (exitCode=${proof?.exitCode ?? 'missing'})`,
        reason: 'Worktree test execution failed or execution proof was missing',
      };
    }

    return {
      isAuthorized: true,
      assertionsPreserved: true,
      testBodyPreserved: true,
      fixturesPreserved: true,
      identityAndActionPreserved: true,
      diffAllowlistPassed: true,
      executionVerified: true,
      summary: 'Intent Invariant v2 satisfied: V = A ∧ T ∧ F ∧ I ∧ D ∧ E (Authorized for workspace promotion)',
    };
  }

  /**
   * INVARIANT: Input Data Integrity.
   * Tests are executable business specifications. Repairing a broken locator or timing
   * issue MUST NOT mutate business input parameters (quantities, credentials, search queries, prices).
   */
  public static validateInputDataIntegrity(
    originalSource: string,
    patchedSource: string
  ): { isValid: boolean; reason?: string } {
    const extractInputs = (source: string): Array<{ action: string; arg: string }> => {
      const inputs: Array<{ action: string; arg: string }> = [];
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile('temp.spec.ts', source, { overwrite: true });

      sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expr = node.getExpression();
          if (Node.isPropertyAccessExpression(expr)) {
            const actionName = expr.getName();
            if (actionName === 'fill' || actionName === 'type' || actionName === 'selectOption') {
              const firstArg = node.getArguments()[0];
              if (firstArg) {
                let argText = firstArg.getText().trim();
                if (Node.isStringLiteral(firstArg)) {
                  argText = firstArg.getLiteralValue();
                } else if (
                  (argText.startsWith("'") && argText.endsWith("'")) ||
                  (argText.startsWith('"') && argText.endsWith('"')) ||
                  (argText.startsWith('`') && argText.endsWith('`'))
                ) {
                  argText = argText.slice(1, -1);
                }
                inputs.push({ action: actionName, arg: argText });
              }
            }
          }
        }
      });
      return inputs;
    };

    const origInputs = extractInputs(originalSource);
    const patchedInputs = extractInputs(patchedSource);

    if (origInputs.length !== patchedInputs.length) {
      return {
        isValid: false,
        reason: `Input data invariant violated: Input action count changed from ${origInputs.length} to ${patchedInputs.length}. Test inputs cannot be added or removed.`,
      };
    }

    for (let i = 0; i < origInputs.length; i++) {
      if (origInputs[i]!.action !== patchedInputs[i]!.action) {
        return {
          isValid: false,
          reason: `Input data invariant violated: Input action type changed at index ${i} from '${origInputs[i]!.action}' to '${patchedInputs[i]!.action}'.`,
        };
      }
      if (origInputs[i]!.arg !== patchedInputs[i]!.arg) {
        return {
          isValid: false,
          reason: `Input data invariant violated: Action payload mutated from '${origInputs[i]!.arg}' to '${patchedInputs[i]!.arg}'. Test inputs cannot be altered to force a pass.`,
        };
      }
    }

    return { isValid: true };
  }

  /**
   * INVARIANT: Workflow Step Integrity.
   * Repairs must not delete, add, or reorder intermediate workflow steps (e.g. swapping or skipping checkout steps).
   */
  public static validateWorkflowStepIntegrity(
    originalSource: string,
    patchedSource: string
  ): { isValid: boolean; reason?: string } {
    const extractActionSequence = (source: string): string[] => {
      const actions: string[] = [];
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile('temp.spec.ts', source, { overwrite: true });
      const approvedActions = new Set([
        'click',
        'fill',
        'type',
        'selectOption',
        'check',
        'uncheck',
        'press',
        'goto',
        'dblclick',
        'hover',
        'focus',
      ]);

      sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expr = node.getExpression();
          if (Node.isPropertyAccessExpression(expr)) {
            const actionName = expr.getName();
            if (approvedActions.has(actionName)) {
              actions.push(actionName);
            }
          }
        }
      });
      return actions;
    };

    const origActions = extractActionSequence(originalSource);
    const patchedActions = extractActionSequence(patchedSource);

    if (origActions.length !== patchedActions.length) {
      return {
        isValid: false,
        reason: `Workflow sequence invariant violated: Test step count changed from ${origActions.length} to ${patchedActions.length}. Repair cannot delete, add, or bypass intermediate test steps.`,
      };
    }

    for (let i = 0; i < origActions.length; i++) {
      if (origActions[i] !== patchedActions[i]) {
        return {
          isValid: false,
          reason: `Workflow sequence invariant violated: Action sequence altered at step ${i + 1} (expected '${origActions[i]}', found '${patchedActions[i]}'). Test action order must be preserved.`,
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Unified v2 entry point. Preserves backward compatibility while enforcing fail-closed
   * authorization when mode !== 'pre-flight'.
   */
  public static validateV2(target: IntentV2ValidationTarget): IntentV2ValidationResult {
    if (!target.originalCompositeFingerprint) {
      return {
        isValid: false,
        assertionsPreserved: false,
        testBodyPreserved: false,
        fixturesPreserved: false,
        identityAndActionPreserved: false,
        diffAllowlistPassed: false,
        executionVerified: false,
        reason: 'Missing original composite fingerprint',
        summary: 'Rejected: Baseline composite fingerprint was not provided',
      };
    }

    const isPreflight = target.mode === 'pre-flight';

    // Branch 1: Dedicated validation for statement-level repairs (where test specification is directly patched)
    if (target.pattern === 'statement-patch') {
      const origSource = target.pageObjectOriginalSource ?? '';
      const patchedSource = target.pageObjectPatchedSource ?? '';

      // 1. Assertions Invariant: All original assertions must remain strictly intact
      const origAssertions = AssertionHasher.extractAssertionRecordsFromSource(origSource);
      const postAssertions = AssertionHasher.extractAssertionRecordsFromSource(patchedSource);
      const postSet = new Set(postAssertions.map((a) => JSON.stringify(a)));
      const assertionsPreserved = origAssertions.every((a) => postSet.has(JSON.stringify(a)));

      if (!assertionsPreserved) {
        throw new AssertionTamperedError(
          JSON.stringify(origAssertions),
          JSON.stringify(postAssertions)
        );
      }

      // 2. Input data invariant
      const inputCheck = IntentValidator.validateInputDataIntegrity(origSource, patchedSource);
      if (!inputCheck.isValid) {
        return {
          isValid: false,
          assertionsPreserved: true,
          testBodyPreserved: false,
          fixturesPreserved: false,
          identityAndActionPreserved: false,
          diffAllowlistPassed: false,
          executionVerified: false,
          reason: inputCheck.reason,
          summary: `Rejected: ${inputCheck.reason}`,
        };
      }

      // 3. Workflow step integrity
      const workflowCheck = IntentValidator.validateWorkflowStepIntegrity(origSource, patchedSource);
      if (!workflowCheck.isValid) {
        return {
          isValid: false,
          assertionsPreserved: true,
          testBodyPreserved: false,
          fixturesPreserved: false,
          identityAndActionPreserved: false,
          diffAllowlistPassed: false,
          executionVerified: false,
          reason: workflowCheck.reason,
          summary: `Rejected: ${workflowCheck.reason}`,
        };
      }

      // 4. Statement Diff Allowlist
      const diffResult = StatementDiffAllowlistValidator.validate({
        originalSource: origSource,
        patchedSource: patchedSource,
      });

      if (!diffResult.isAllowed) {
        throw new UnauthorizedAstModificationError(diffResult.reason ?? 'Unknown violation');
      }

      // 5. Target identity & business oracle
      const identityCheck = IntentValidator.verifyTargetIdentity(target.originalSelector, target.candidateElement);
      if (target.businessOracleStatus === 'contradicted') {
        return {
          isValid: false,
          assertionsPreserved: true,
          testBodyPreserved: true,
          fixturesPreserved: true,
          identityAndActionPreserved: false,
          diffAllowlistPassed: true,
          executionVerified: false,
          reason: 'Business oracle contradicted the candidate identity',
          summary: 'Rejected: Independent business oracle contradicted target identity',
        };
      }

      // 6. Execution Verification
      let executionVerified = false;
      if (
        target.executionProof &&
        target.executionProof.passed === true &&
        target.executionProof.exitCode === 0 &&
        (target.executionProof.executionOutcome === 'PASS' || target.executionProof.executionOutcome === undefined) &&
        target.executionProof.assertionIntegrityValid !== false
      ) {
        executionVerified = true;
      }

      const isValid = isPreflight
        ? assertionsPreserved && inputCheck.isValid && workflowCheck.isValid && diffResult.isAllowed && identityCheck.isPreserved
        : assertionsPreserved && inputCheck.isValid && workflowCheck.isValid && diffResult.isAllowed && identityCheck.isPreserved && executionVerified;

      return {
        isValid,
        assertionsPreserved: true,
        testBodyPreserved: true,
        fixturesPreserved: true,
        identityAndActionPreserved: identityCheck.isPreserved,
        diffAllowlistPassed: diffResult.isAllowed,
        executionVerified,
        reason: identityCheck.reason,
        summary: isValid
          ? isPreflight
            ? 'Pre-flight Statement Repair Invariant passed: V_stmt_pre = A_pres ∧ I_data ∧ W_step ∧ D_stmt'
            : 'Statement Repair Intent Invariant v2 satisfied: V_stmt = A_pres ∧ I_data ∧ W_step ∧ D_stmt ∧ E (Strict intent preservation proved)'
          : isPreflight
          ? `Pre-flight Statement Repair Invariant failed: ${identityCheck.reason ?? 'Semantic invariant failed'}`
          : 'Statement Repair Intent Invariant v2 failed: Missing or failing execution proof',
      };
    }

    const preflight = IntentValidator.validateProposal({
      testFilePath: target.testFilePath,
      originalCompositeFingerprint: target.originalCompositeFingerprint,
      candidateElement: target.candidateElement,
      intendedAction: target.intendedAction,
      originalSelector: target.originalSelector,
      businessOracleStatus: target.businessOracleStatus,
    });

    if (!preflight.isValid) {
      return {
        isValid: false,
        assertionsPreserved: preflight.assertionsPreserved,
        testBodyPreserved: preflight.testBodyPreserved,
        fixturesPreserved: preflight.fixturesPreserved,
        identityAndActionPreserved: preflight.identityAndActionPreserved,
        diffAllowlistPassed: false,
        executionVerified: false,
        reason: preflight.reason,
        summary: preflight.summary,
      };
    }

    // Input data and workflow sequence checks
    if (target.pageObjectOriginalSource && target.pageObjectPatchedSource) {
      const inputCheck = IntentValidator.validateInputDataIntegrity(
        target.pageObjectOriginalSource,
        target.pageObjectPatchedSource
      );
      if (!inputCheck.isValid) {
        return {
          isValid: false,
          assertionsPreserved: preflight.assertionsPreserved,
          testBodyPreserved: false,
          fixturesPreserved: false,
          identityAndActionPreserved: preflight.identityAndActionPreserved,
          diffAllowlistPassed: false,
          executionVerified: false,
          reason: inputCheck.reason,
          summary: `Rejected: ${inputCheck.reason}`,
        };
      }

      const workflowCheck = IntentValidator.validateWorkflowStepIntegrity(
        target.pageObjectOriginalSource,
        target.pageObjectPatchedSource
      );
      if (!workflowCheck.isValid) {
        return {
          isValid: false,
          assertionsPreserved: preflight.assertionsPreserved,
          testBodyPreserved: false,
          fixturesPreserved: false,
          identityAndActionPreserved: preflight.identityAndActionPreserved,
          diffAllowlistPassed: false,
          executionVerified: false,
          reason: workflowCheck.reason,
          summary: `Rejected: ${workflowCheck.reason}`,
        };
      }
    }

    // 5. D: Diff Allowlist
    let diffAllowlistPassed = false;
    if (
      target.pageObjectOriginalSource &&
      target.pageObjectPatchedSource &&
      target.pageObjectClassName &&
      target.targetMemberName
    ) {
      const diffResult = DiffAllowlistValidator.validate({
        originalSource: target.pageObjectOriginalSource,
        patchedSource: target.pageObjectPatchedSource,
        targetClassName: target.pageObjectClassName,
        targetMemberName: target.targetMemberName,
      });

      if (!diffResult.isAllowed) {
        throw new UnauthorizedAstModificationError(diffResult.reason ?? 'Unknown violation');
      }
      diffAllowlistPassed = true;
    } else if (isPreflight) {
      diffAllowlistPassed = true;
    } else {
      diffAllowlistPassed = false;
    }

    // 6. E: Execution Verification (P0: Requires genuine, validated execution proof - no boolean shortcuts)
    let executionVerified = false;
    if (
      target.executionProof &&
      target.executionProof.passed === true &&
      target.executionProof.exitCode === 0 &&
      (target.executionProof.executionOutcome === 'PASS' || target.executionProof.executionOutcome === undefined) &&
      target.executionProof.assertionIntegrityValid !== false
    ) {
      executionVerified = true;
    } else {
      executionVerified = false;
    }

    const isValid = isPreflight
      ? preflight.isValid && diffAllowlistPassed
      : preflight.isValid && diffAllowlistPassed && executionVerified;

    return {
      isValid,
      assertionsPreserved: preflight.assertionsPreserved,
      testBodyPreserved: preflight.testBodyPreserved,
      fixturesPreserved: preflight.fixturesPreserved,
      identityAndActionPreserved: preflight.identityAndActionPreserved,
      diffAllowlistPassed,
      executionVerified,
      summary: isValid
        ? isPreflight
          ? 'Pre-flight Intent Invariant passed: V_pre = A ∧ T ∧ F ∧ I'
          : 'Intent Invariant v2 satisfied: V = A ∧ T ∧ F ∧ I ∧ D ∧ E (Strict intent preservation proved)'
        : isPreflight
        ? 'Pre-flight Intent Invariant failed one or more semantic clauses'
        : 'Intent Invariant v2 failed one or more clauses (Missing execution proof or diff allowlist rejection)',
    };
  }

  private static checkActionSemantics(intendedAction: string, el: ResolvedElement): boolean {
    const action = intendedAction.toLowerCase();
    if (action.includes('click')) {
      return (
        el.tag === 'button' ||
        el.tag === 'a' ||
        el.role === 'button' ||
        el.role === 'link' ||
        el.role === 'menuitem' ||
        el.role === 'tab' ||
        Boolean(el.attributes?.['onclick']) ||
        Boolean(el.attributes?.['href']) ||
        el.tag === 'div' ||
        el.tag === 'span' ||
        el.tag === 'td'
      );
    }
    if (action.includes('fill') || action.includes('type')) {
      return (
        el.tag === 'input' ||
        el.tag === 'textarea' ||
        el.role === 'textbox' ||
        el.attributes['contenteditable'] === 'true'
      );
    }
    return true;
  }
}
