import { ProjectIntelligenceSnapshot, getDecayedHistoricalSelectorScore } from '../intelligence/project-intelligence.js';
import { CandidateExtractor } from './candidate-extractor.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';
import { ScoredCandidate } from './abstention-policy.js';
import { SelectorScorer, SelectorProjectContext } from './selector-scorer.js';

export interface RankedRepairCandidate extends ScoredCandidate {
  locatorExpression: string;
}

export class RepairCandidateRanker {
  public static rank(
    candidates: ResolvedElement[],
    originalSelector?: string,
    intendedAction?: string,
    intelligence?: ProjectIntelligenceSnapshot,
  ): RankedRepairCandidate[] {
    const projectContext: SelectorProjectContext | undefined = intelligence?.profile
      ? {
          preferredLocator: intelligence.profile.locatorConventions.preferred,
          locatorUsage: {
            getByRole: intelligence.profile.locatorConventions.getByRole,
            getByTestId: intelligence.profile.locatorConventions.getByTestId,
            getByLabel: intelligence.profile.locatorConventions.getByLabel,
            getByText: intelligence.profile.locatorConventions.getByText,
            locator: intelligence.profile.locatorConventions.locator,
          },
        }
      : undefined;

    return candidates.flatMap((candidate) => {
      try {
        const locatorExpression = CandidateExtractor.generateLocator(candidate, 'page');
        const breakdown = SelectorScorer.score(
          candidate,
          candidates,
          originalSelector,
          getDecayedHistoricalSelectorScore(intelligence, locatorExpression),
          undefined,
          projectContext,
        );
        return [{
          candidate,
          element: candidate,
          breakdown,
          locatorExpression,
          originalSelector,
          intendedAction,
        }];
      } catch {
        return [];
      }
    }).sort((left, right) => right.breakdown.score - left.breakdown.score);
  }
}
