import { ProjectIntelligenceSnapshot, getDecayedHistoricalSelectorScore } from '../intelligence/project-intelligence.js';
import { CandidateExtractor } from './candidate-extractor.js';
import { ResolvedElement } from '../trace/snapshot-resolver.js';
import { ScoredCandidate } from './abstention-policy.js';
import { SelectorScorer, SelectorProjectContext } from './selector-scorer.js';
import { LocatorDisambiguationEngine } from '../intelligence/locator-disambiguation-engine.js';

export interface RankedRepairCandidate extends ScoredCandidate {
  locatorExpression: string;
}

export class RepairCandidateRanker {
  public static rank(
    candidates: ResolvedElement[],
    originalSelector?: string,
    intendedAction?: string,
    intelligence?: ProjectIntelligenceSnapshot,
    rootDom?: ResolvedElement,
    testIntentText?: string,
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

    const disambiguation =
      candidates.length > 1
        ? LocatorDisambiguationEngine.disambiguate(
            candidates,
            { originalSelector, intendedAction, rootDom, testIntentText },
            'page'
          )
        : undefined;

    return candidates
      .flatMap((candidate) => {
        try {
          let locatorExpression = CandidateExtractor.generateLocator(candidate, 'page');
          const isDisambiguatedTarget =
            disambiguation &&
            disambiguation.isUnique &&
            disambiguation.resolvedCandidate === candidate;

          if (isDisambiguatedTarget && disambiguation.resolvedExpression) {
            locatorExpression = disambiguation.resolvedExpression;
          }

          const breakdown = SelectorScorer.score(
            candidate,
            candidates,
            originalSelector,
            getDecayedHistoricalSelectorScore(intelligence, locatorExpression),
            undefined,
            projectContext,
          );

          if (isDisambiguatedTarget) {
            breakdown.uniqueness = 1.0;
            breakdown.matchCount = 1;
            breakdown.explanation.push(
              `Disambiguation Applied: ${disambiguation.strategy} -> ${disambiguation.explanation}`
            );
          }

          return [
            {
              candidate,
              element: candidate,
              breakdown,
              locatorExpression,
              originalSelector,
              intendedAction,
              parentScopeVerified: isDisambiguatedTarget ? true : undefined,
              disambiguationStrategy: isDisambiguatedTarget ? disambiguation.strategy : undefined,
              disambiguationExplanation: isDisambiguatedTarget ? disambiguation.explanation : undefined,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.breakdown.score - left.breakdown.score);
  }
}
