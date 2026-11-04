import { AssertionHasher } from './assertion-hasher.js';
import { AssertionTamperedError, AbstentionError } from '../core/errors/engine-errors.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';

export interface ValidationTarget {
  testFilePath: string;
  originalFingerprint: string;
  candidateElement: ResolvedElement;
  intendedAction: string; // e.g. "click", "fill"
  businessOracleStatus?: 'verified' | 'contradicted' | 'unavailable';
}

export interface IntentValidationResult {
  isValid: boolean;
  assertionPreserved: boolean;
  actionSemanticsValid: boolean;
  identityPreserved: boolean;
  reason?: string;
}

export class IntentValidator {
  /**
   * Validates that the candidate repair preserves test intent and strictly protects assertions.
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

      if (!isClickable && el.tag !== 'div' && el.tag !== 'span') {
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
}
