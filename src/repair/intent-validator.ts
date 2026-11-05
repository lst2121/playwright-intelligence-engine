import { AssertionHasher, CompositeIntentFingerprint } from './assertion-hasher.js';
import { DiffAllowlistValidator } from './diff-allowlist.js';
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
  mode?: 'pre-flight' | 'authorization' | undefined;
  strict?: boolean | undefined;
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable' | undefined;
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
  assertionsPreserved: boolean;     // A
  testBodyPreserved: boolean;       // T
  fixturesPreserved: boolean;       // F
  identityAndActionPreserved: boolean; // I
  diffAllowlistPassed: boolean;     // D
  executionVerified: boolean;       // E
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
      positive: ['create', 'add', 'insert', 'new'],
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

    // 1. Hard Conflict Check: Reject substituting positive action with negative/cancellation action
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
          reason: `Identity violation: Target '${originalSelector}' appears to be a cancellation action, but replacement candidate has confirmation semantics.`,
        };
      }
    }

    return { isPreserved: true };
  }

  /**
   * Validates that the candidate repair preserves test intent and strictly protects assertions.
   * Fail-closed: Enforces action semantics AND identity preservation.
   */
  public static validate(target: ValidationTarget): IntentValidationResult {
    // Check 1: Assertion AST Immutability Check
    const postPatchFingerprint = AssertionHasher.computeFingerprint(target.testFilePath);
    if (postPatchFingerprint !== target.originalFingerprint) {
      throw new AssertionTamperedError(target.originalFingerprint, postPatchFingerprint);
    }

    // Check 2: Action Semantics Validation (element must support the intended user action)
    const el = target.candidateElement;
    const action = target.intendedAction.toLowerCase();
    let actionSemanticsValid = true;

    if (action.includes('click')) {
      const isClickable =
        el.tag === 'button' ||
        el.tag === 'a' ||
        el.role === 'button' ||
        el.role === 'link' ||
        el.role === 'menuitem' ||
        el.role === 'tab' ||
        Boolean(el.attributes['onclick']) ||
        Boolean(el.attributes['href']);

      if (!isClickable && el.tag !== 'div' && el.tag !== 'span' && el.tag !== 'td') {
        actionSemanticsValid = false;
      }
    } else if (action.includes('fill') || action.includes('type')) {
      const isInput =
        el.tag === 'input' ||
        el.tag === 'textarea' ||
        el.role === 'textbox' ||
        el.attributes['contenteditable'] === 'true';

      if (!isInput) {
        actionSemanticsValid = false;
      }
    }

    // Check 3: Independent Target Identity Validation
    const identityCheck = IntentValidator.verifyTargetIdentity(target.originalSelector, target.candidateElement);
    if (!identityCheck.isPreserved) {
      return {
        isValid: false,
        assertionPreserved: true,
        actionSemanticsValid,
        identityPreserved: false,
        reason: identityCheck.reason,
      };
    }

    // Check 4: Business Oracle contradiction check
    if (target.businessOracleStatus === 'contradicted') {
      return {
        isValid: false,
        assertionPreserved: true,
        actionSemanticsValid,
        identityPreserved: false,
        reason: 'Independent business oracle contradicted the candidate outcome',
      };
    }

    return {
      isValid: actionSemanticsValid && identityCheck.isPreserved,
      assertionPreserved: true,
      actionSemanticsValid,
      identityPreserved: identityCheck.isPreserved,
    };
  }

  /**
   * Validates the formal Intent Invariant v2 Contract:
   * V = A ∧ T ∧ F ∧ I ∧ D ∧ E
   *
   * A: Assertion Fingerprint Unchanged
   * T: Test-Body Structural Fingerprint Unchanged
   * F: Fixture & Input Parameters Unchanged
   * I: Target Identity & Action Semantics Preserved
   * D: Diff Allowlist Verified (Only designated locator AST expression altered)
   * E: Independent Execution in Worktree Verified
   */
  public static validateV2(target: IntentV2ValidationTarget): IntentV2ValidationResult {
    // Fail-closed checks on required inputs
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

    const postPatch = AssertionHasher.computeCompositeFingerprint(target.testFilePath);

    // 1. A: Assertion Invariant
    const assertionsPreserved =
      postPatch.assertionFingerprint === target.originalCompositeFingerprint.assertionFingerprint;
    if (!assertionsPreserved) {
      throw new AssertionTamperedError(
        target.originalCompositeFingerprint.assertionFingerprint,
        postPatch.assertionFingerprint
      );
    }

    // 2. T: Test Body Structural Invariant
    const testBodyPreserved =
      postPatch.testBodyFingerprint === target.originalCompositeFingerprint.testBodyFingerprint;
    if (!testBodyPreserved) {
      throw new IntentInvariantViolationError(
        'TestBodyStructure',
        'Test statement order, control flow, conditions, or test body AST nodes were modified.'
      );
    }

    // 3. F: Fixture & Parameter Invariant
    const fixturesPreserved =
      postPatch.fixtureFingerprint === target.originalCompositeFingerprint.fixtureFingerprint;
    if (!fixturesPreserved) {
      throw new IntentInvariantViolationError(
        'FixtureParameters',
        'Test fixtures, input parameters, or literal values were altered or reordered.'
      );
    }

    // 4. I: Target Identity & Action Semantics
    const el = target.candidateElement;
    const action = target.intendedAction.toLowerCase();
    let actionSemanticsValid = true;

    if (action.includes('click')) {
      const isClickable =
        el.tag === 'button' ||
        el.tag === 'a' ||
        el.role === 'button' ||
        el.role === 'link' ||
        el.role === 'menuitem' ||
        el.role === 'tab' ||
        Boolean(el.attributes['onclick']) ||
        Boolean(el.attributes['href']);

      if (!isClickable && el.tag !== 'div' && el.tag !== 'span' && el.tag !== 'td') {
        actionSemanticsValid = false;
      }
    } else if (action.includes('fill') || action.includes('type')) {
      const isInput =
        el.tag === 'input' ||
        el.tag === 'textarea' ||
        el.role === 'textbox' ||
        el.attributes['contenteditable'] === 'true';

      if (!isInput) {
        actionSemanticsValid = false;
      }
    }

    // Validate identity preservation (avoiding swap of submit with cancel)
    const identityCheck = IntentValidator.verifyTargetIdentity(target.originalSelector, target.candidateElement);
    const identityAndActionPreserved = actionSemanticsValid && identityCheck.isPreserved;

    if (!identityAndActionPreserved) {
      return {
        isValid: false,
        assertionsPreserved,
        testBodyPreserved,
        fixturesPreserved,
        identityAndActionPreserved: false,
        diffAllowlistPassed: false,
        executionVerified: false,
        reason: identityCheck.reason ?? 'Incompatible action semantics',
        summary: `Rejected: ${identityCheck.reason ?? 'Target action semantics invalid'}`,
      };
    }

    if (target.businessOracleStatus === 'contradicted') {
      return {
        isValid: false,
        assertionsPreserved: true,
        testBodyPreserved: true,
        fixturesPreserved: true,
        identityAndActionPreserved: false,
        diffAllowlistPassed: false,
        executionVerified: false,
        reason: 'Business oracle contradicted the candidate identity',
        summary: 'Rejected: Independent business oracle contradicted target identity',
      };
    }

    const isPreflight = target.mode === 'pre-flight';

    // 5. D: Diff Allowlist (Fail-closed: missing diff inputs strictly fail validation in authorization mode)
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

    // 6. E: Execution Verification (Fail-closed: executionPassed must strictly be true in authorization mode)
    let executionVerified = false;
    if (target.executionPassed === true) {
      executionVerified = true;
    } else if (isPreflight) {
      executionVerified = false;
    } else {
      executionVerified = false;
    }

    const isValid = isPreflight
      ? assertionsPreserved &&
        testBodyPreserved &&
        fixturesPreserved &&
        identityAndActionPreserved &&
        diffAllowlistPassed
      : assertionsPreserved &&
        testBodyPreserved &&
        fixturesPreserved &&
        identityAndActionPreserved &&
        diffAllowlistPassed &&
        executionVerified;

    return {
      isValid,
      assertionsPreserved,
      testBodyPreserved,
      fixturesPreserved,
      identityAndActionPreserved,
      diffAllowlistPassed,
      executionVerified,
      summary: isValid
        ? isPreflight
          ? 'Pre-flight Intent Invariant passed: V_pre = A ∧ T ∧ F ∧ I (Pending isolated worktree execution)'
          : 'Intent Invariant v2 satisfied: V = A ∧ T ∧ F ∧ I ∧ D ∧ E (Strict intent preservation proved)'
        : isPreflight
        ? 'Pre-flight Intent Invariant failed one or more semantic clauses'
        : 'Intent Invariant v2 failed one or more clauses (Missing execution proof or diff allowlist rejection)',
    };
  }
}
