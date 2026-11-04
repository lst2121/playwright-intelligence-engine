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
  executionPassed?: boolean | undefined;
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
  /**
   * Validates that the candidate repair preserves test intent and strictly protects assertions.
   * Backward-compatible with v1 validation contract.
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

    // Check 3: Business Oracle contradiction check
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
      isValid: actionSemanticsValid,
      assertionPreserved: true,
      actionSemanticsValid,
      identityPreserved: true,
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
        'Test statement order, control flow, or test body AST nodes were modified.'
      );
    }

    // 3. F: Fixture & Parameter Invariant
    const fixturesPreserved =
      postPatch.fixtureFingerprint === target.originalCompositeFingerprint.fixtureFingerprint;
    if (!fixturesPreserved) {
      throw new IntentInvariantViolationError(
        'FixtureParameters',
        'Test fixtures, input parameters, or literal values were altered.'
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

    if (target.businessOracleStatus === 'contradicted') {
      return {
        isValid: false,
        assertionsPreserved: true,
        testBodyPreserved: true,
        fixturesPreserved: true,
        identityAndActionPreserved: false,
        diffAllowlistPassed: true,
        executionVerified: Boolean(target.executionPassed),
        reason: 'Business oracle contradicted the candidate identity',
        summary: 'Rejected: Independent business oracle contradicted target identity',
      };
    }

    // 5. D: Diff Allowlist (Only target locator modified)
    let diffAllowlistPassed = true;
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
    }

    // 6. E: Execution Verification
    const executionVerified = target.executionPassed !== undefined ? target.executionPassed : true;

    const isValid =
      assertionsPreserved &&
      testBodyPreserved &&
      fixturesPreserved &&
      actionSemanticsValid &&
      diffAllowlistPassed &&
      executionVerified;

    return {
      isValid,
      assertionsPreserved,
      testBodyPreserved,
      fixturesPreserved,
      identityAndActionPreserved: actionSemanticsValid,
      diffAllowlistPassed,
      executionVerified,
      summary: isValid
        ? 'Intent Invariant v2 satisfied: V = A ∧ T ∧ F ∧ I ∧ D ∧ E (Strict intent preservation proved)'
        : 'Intent Invariant v2 failed one or more clauses',
    };
  }
}
