import { ScoreBreakdown } from './selector-scorer.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';

export interface ScoredCandidate {
  element: ResolvedElement;
  breakdown: ScoreBreakdown;
}

export interface AbstentionDecision {
  shouldAbstain: boolean;
  selectedCandidate?: ScoredCandidate;
  reason?: string;
}

export class AbstentionPolicy {
  public static readonly MINIMUM_CONFIDENCE_THRESHOLD = 0.70;
  public static readonly AMBIGUITY_DELTA_THRESHOLD = 0.08;

  /**
   * Applies the abstention policy to ranked candidates.
   */
  public static evaluate(candidates: ScoredCandidate[]): AbstentionDecision {
    if (candidates.length === 0) {
      return {
        shouldAbstain: true,
        reason: 'Zero matching candidate elements found in DOM snapshot',
      };
    }

    // Sort descending by score
    const sorted = [...candidates].sort((a, b) => b.breakdown.score - a.breakdown.score);
    const top = sorted[0]!;

    // Rule 1: Confidence Threshold
    if (top.breakdown.score < AbstentionPolicy.MINIMUM_CONFIDENCE_THRESHOLD) {
      return {
        shouldAbstain: true,
        reason: `Highest candidate confidence (${(top.breakdown.score * 100).toFixed(1)}%) is below minimum safety threshold (${(AbstentionPolicy.MINIMUM_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%)`,
      };
    }

    // Rule 2: Ambiguity Delta Check (if top two candidates are neck and neck, guess is unsafe)
    if (sorted.length > 1) {
      const runnerUp = sorted[1]!;
      const delta = top.breakdown.score - runnerUp.breakdown.score;
      if (delta < AbstentionPolicy.AMBIGUITY_DELTA_THRESHOLD) {
        return {
          shouldAbstain: true,
          reason: `Ambiguous match: top two candidate elements have nearly identical scores (${top.breakdown.score} vs ${runnerUp.breakdown.score}, delta: ${delta.toFixed(3)}). Abstaining to prevent incorrect action dispatch.`,
        };
      }
    }

    // Rule 3: Strict Uniqueness Violation
    if (top.breakdown.uniqueness < 0.5) {
      return {
        shouldAbstain: true,
        reason: 'Selected candidate element is not unique within DOM scope (potential strict mode violation)',
      };
    }

    return {
      shouldAbstain: false,
      selectedCandidate: top,
    };
  }
}
