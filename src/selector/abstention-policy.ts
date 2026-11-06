import { ScoreBreakdown } from './selector-scorer.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';

export interface ScoredCandidate {
  element: ResolvedElement;
  breakdown: ScoreBreakdown;
  locatorExpression?: string | undefined;
  originalSelector?: string | undefined;
  intendedAction?: string | undefined; // e.g. "click", "fill"
  parentScopeVerified?: boolean | undefined;
}

export type DecisionStage =
  | 'SUPPORTED_ELEMENT'
  | 'TARGET_IDENTITY'
  | 'STRICT_UNIQUENESS'
  | 'ACTION_SEMANTICS'
  | 'SCORE_CONFIDENCE'
  | 'AMBIGUITY_DELTA'
  | 'AUTHORIZED';

export interface AbstentionDecision {
  shouldAbstain: boolean;
  stage: DecisionStage;
  selectedCandidate?: ScoredCandidate | undefined;
  reason?: string | undefined;
}

export class AbstentionPolicy {
  public static readonly MINIMUM_CONFIDENCE_THRESHOLD = 0.70;
  public static readonly AMBIGUITY_DELTA_THRESHOLD = 0.08;

  /**
   * Applies the formal Multi-Stage Decision Pipeline to candidate locators:
   * 1. Supported Element? (Must be recognized interactive element)
   * 2. Target Identity Verified? (Affinity to intended business entity)
   * 3. Exactly One Scoped Match? (Strict Uniqueness: matchCount === 1, unless parentScopeVerified)
   * 4. Action Semantics Preserved? (e.g. click -> clickable element, fill -> input/textarea)
   * 5. Score & Calibrated Threshold Pass? (rawScore >= 0.70)
   * 6. Ambiguity Delta Pass? (top.score - runnerUp.score >= 0.08)
   */
  public static evaluate(candidates: ScoredCandidate[]): AbstentionDecision {
    if (candidates.length === 0) {
      return {
        shouldAbstain: true,
        stage: 'SUPPORTED_ELEMENT',
        reason: 'Zero matching candidate elements found in DOM snapshot',
      };
    }

    // Sort descending by score
    const sorted = [...candidates].sort((a, b) => b.breakdown.score - a.breakdown.score);
    const top = sorted[0]!;

    // Stage 1: Supported Element Check
    const supportedTags = new Set([
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'option',
      'div',
      'span',
      'li',
      'td',
      'th',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'label',
      'img',
      'form',
    ]);
    if (!supportedTags.has(top.element.tag) && !top.element.role) {
      return {
        shouldAbstain: true,
        stage: 'SUPPORTED_ELEMENT',
        reason: `Unsupported DOM tag '<${top.element.tag}>' without ARIA role cannot be safely automated.`,
      };
    }

    // Stage 2: Target Identity Verification
    if (top.breakdown.identityMatch < 0.4) {
      return {
        shouldAbstain: true,
        stage: 'TARGET_IDENTITY',
        reason: `Target identity mismatch: candidate accessible name '${top.element.accessibleName ?? 'unnamed'}' does not align with original selector intent.`,
      };
    }

    // Stage 3: Strict Uniqueness Gate (CRITICAL: matchCount !== 1 triggers ABSTAIN)
    // Exactly 2 or more matches fail the uniqueness requirement unless parentScopeVerified is true
    if (top.breakdown.matchCount !== 1 && !top.parentScopeVerified) {
      return {
        shouldAbstain: true,
        stage: 'STRICT_UNIQUENESS',
        reason: `NON_UNIQUE_CANDIDATE: Candidate element matches ${top.breakdown.matchCount} elements in DOM. Strict uniqueness requires exactly 1 match (U = 1.0) unless scoped by a verified parent container.`,
      };
    }

    // Stage 4: Action Semantics Check
    if (top.intendedAction) {
      const action = top.intendedAction.toLowerCase();
      if (action.includes('click')) {
        const isClickable =
          top.element.tag === 'button' ||
          top.element.tag === 'a' ||
          top.element.role === 'button' ||
          top.element.role === 'link' ||
          top.element.role === 'tab' ||
          top.element.role === 'menuitem' ||
          Boolean(top.element.attributes?.['onclick']) ||
          Boolean(top.element.attributes?.['href']);

        if (!isClickable && top.element.tag !== 'div' && top.element.tag !== 'span' && top.element.tag !== 'td') {
          return {
            shouldAbstain: true,
            stage: 'ACTION_SEMANTICS',
            reason: `Action semantics violation: action '${top.intendedAction}' cannot be safely dispatched to non-clickable element <${top.element.tag}>.`,
          };
        }
      } else if (action.includes('fill') || action.includes('type')) {
        const isInput =
          top.element.tag === 'input' ||
          top.element.tag === 'textarea' ||
          top.element.role === 'textbox' ||
          top.element.attributes['contenteditable'] === 'true';

        if (!isInput) {
          return {
            shouldAbstain: true,
            stage: 'ACTION_SEMANTICS',
            reason: `Action semantics violation: fill/type action requires input or textbox element, but found <${top.element.tag}>.`,
          };
        }
      }
    }

    // Stage 5: Confidence Threshold Gate
    if (top.breakdown.score < AbstentionPolicy.MINIMUM_CONFIDENCE_THRESHOLD) {
      return {
        shouldAbstain: true,
        stage: 'SCORE_CONFIDENCE',
        reason: `Highest candidate confidence (${(top.breakdown.score * 100).toFixed(1)}%) is below minimum safety threshold (${(AbstentionPolicy.MINIMUM_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%)`,
      };
    }

    // Stage 6: Ambiguity Delta Gate (if top two candidates are neck and neck, guess is unsafe)
    if (sorted.length > 1) {
      const runnerUp = sorted[1]!;
      const delta = parseFloat((top.breakdown.score - runnerUp.breakdown.score).toFixed(3));
      const identitySeparation = top.breakdown.identityMatch - runnerUp.breakdown.identityMatch;
      const hasStrongIdentitySeparation = top.breakdown.identityMatch >= 0.9 && identitySeparation >= 0.12;
      if (delta < AbstentionPolicy.AMBIGUITY_DELTA_THRESHOLD && !hasStrongIdentitySeparation) {
        return {
          shouldAbstain: true,
          stage: 'AMBIGUITY_DELTA',
          reason: `Ambiguous match: top two candidate elements have nearly identical scores (${top.breakdown.score} vs ${runnerUp.breakdown.score}, delta: ${delta.toFixed(3)} < threshold ${AbstentionPolicy.AMBIGUITY_DELTA_THRESHOLD}). Abstaining to prevent incorrect action dispatch.`,
        };
      }
    }

    return {
      shouldAbstain: false,
      stage: 'AUTHORIZED',
      selectedCandidate: top,
    };
  }
}

