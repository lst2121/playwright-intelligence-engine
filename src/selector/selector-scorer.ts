import { ResolvedElement } from '../trace/snapshot-resolver.js';

export interface ScorerWeights {
  wU: number; // Uniqueness
  wI: number; // Identity Match
  wM: number; // Semantic Match (Role/Label over raw CSS)
  wA: number; // Actionability (visible/enabled)
  wH: number; // Historical Execution Reliability
  wD: number; // Volatile Implementation Dependence penalty
}

export interface ScoreBreakdown {
  score: number;
  transformedScore: number;
  calibratedProbability: number; // Retained as alias for transformedScore
  uniqueness: number;
  matchCount: number;
  identityMatch: number;
  semanticMatch: number;
  actionability: number;
  historicalReliability: number;
  historicalExecutionReliability: number;
  volatilePenalty: number;
  explanation: string[];
}

export class SelectorScorer {
  public static readonly DEFAULT_WEIGHTS: ScorerWeights = {
    wU: 0.25,
    wI: 0.25,
    wM: 0.20,
    wA: 0.15,
    wH: 0.10,
    wD: 0.20,
  };

  /**
   * Scores a candidate element against the multi-factor formula:
   * S(L) = w1*U + w2*I + w3*M + w4*A + w5*H - w6*D
   *
   * Uniqueness evaluates whether the proposed locator resolves to exactly one element.
   * Identity requires affirmative token overlap and rejects contradictory semantics.
   * Actionability verifies enabled state and non-hidden status.
   * Produces a transformed score (sigmoid scaling), not an overclaimed empirical probability.
   */
  public static score(
    candidate: ResolvedElement,
    allCandidates: ResolvedElement[],
    originalSelector?: string,
    historicalScore?: number,
    weights = SelectorScorer.DEFAULT_WEIGHTS
  ): ScoreBreakdown {
    const explanation: string[] = [];

    // 1. Uniqueness U: Evaluated on actual candidate identifying attributes
    const matchingCount = allCandidates.filter((c) => {
      // If role + name exists, check match on role + name
      if (candidate.role && candidate.accessibleName) {
        return c.role === candidate.role && c.accessibleName === candidate.accessibleName;
      }
      // If testid exists, check match on testid
      const candTestId = candidate.attributes['data-testid'] ?? candidate.attributes['data-test'];
      if (candTestId) {
        const cTestId = c.attributes['data-testid'] ?? c.attributes['data-test'];
        return cTestId === candTestId;
      }
      // If id exists, check match on id
      if (candidate.attributes['id']) {
        return c.attributes['id'] === candidate.attributes['id'];
      }
      return c.tag === candidate.tag && c.role === candidate.role && c.accessibleName === candidate.accessibleName;
    }).length;

    const uniqueness = matchingCount === 1 ? 1.0 : matchingCount > 1 ? parseFloat((1 / matchingCount).toFixed(3)) : 0.0;
    explanation.push(`Uniqueness U: ${uniqueness} (${matchingCount} matching element(s) in scope)`);

    // 2. Identity Match I: Entity identity and affirmative token overlap
    let identityMatch = 0.5;
    if (candidate.accessibleName) {
      identityMatch = 0.8;
      if (originalSelector) {
        const origNorm = originalSelector.toLowerCase().replace(/[-_]/g, ' ');
        const nameNorm = candidate.accessibleName.toLowerCase().replace(/[-_]/g, ' ');

        // Hard check: Contradictory semantics (submit vs cancel)
        const positiveWords = ['submit', 'login', 'checkout', 'save', 'confirm', 'proceed', 'pay', 'order'];
        const negativeWords = ['cancel', 'close', 'reset', 'abort', 'back', 'dismiss', 'delete'];

        const origIsPositive = positiveWords.some((t) => origNorm.includes(t));
        const candIsNegative = negativeWords.some((t) => nameNorm.includes(t));
        const origIsNegative = negativeWords.some((t) => origNorm.includes(t));
        const candIsPositive = positiveWords.some((t) => nameNorm.includes(t));

        // Differentiating action token conflicts (e.g. continue shopping vs continue checkout)
        const distinguishingPairs: Array<[string, string]> = [
          ['shopping', 'checkout'],
          ['cart', 'checkout'],
          ['prev', 'next'],
          ['previous', 'next'],
          ['first', 'last'],
          ['left', 'right'],
          ['up', 'down'],
          ['yes', 'no'],
          ['approve', 'reject'],
          ['accept', 'decline'],
          ['enable', 'disable'],
          ['open', 'close'],
        ];

        let hasDistinguishingConflict = false;
        for (const [w1, w2] of distinguishingPairs) {
          if (
            (origNorm.includes(w1) && nameNorm.includes(w2)) ||
            (origNorm.includes(w2) && nameNorm.includes(w1))
          ) {
            hasDistinguishingConflict = true;
            break;
          }
        }

        if (hasDistinguishingConflict) {
          identityMatch = 0.1;
          explanation.push(`Identity Match I: 0.1 (Conflicting action token intent detected)`);
        } else if ((origIsPositive && candIsNegative) || (origIsNegative && candIsPositive)) {
          identityMatch = 0.0;
          explanation.push(`Identity Match I: 0.0 (Hard contradiction: target has opposing confirmation/cancellation semantics)`);
        } else if (origNorm.includes(nameNorm) || nameNorm.includes(origNorm)) {
          identityMatch = 1.0;
        } else {
          // Token overlap
          const origWords = new Set(origNorm.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
          const candWords = new Set(nameNorm.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
          if (origWords.size > 0 && candWords.size > 0) {
            const intersection = [...origWords].filter((w) => candWords.has(w));
            const overlap = intersection.length / Math.min(origWords.size, candWords.size);
            identityMatch = overlap >= 0.5 ? 0.9 : 0.8;
          }
        }
      }
    }
    explanation.push(`Identity Match I: ${identityMatch}`);

    // 3. Semantic Match M: getByRole / getByLabel priority over raw CSS
    let semanticMatch = 0.4; // Base for raw HTML tag
    if (candidate.role && candidate.accessibleName) {
      semanticMatch = 1.0; // Priority: Role + Accessible Name
    } else if (candidate.attributes['data-testid'] || candidate.attributes['data-test']) {
      semanticMatch = 0.9; // Dedicated Test ID
    } else if (candidate.attributes['placeholder'] || candidate.attributes['aria-label']) {
      semanticMatch = 0.85;
    }
    explanation.push(`Semantic Match M: ${semanticMatch} (Role: ${candidate.role ?? 'none'})`);

    // 4. Actionability A: Element is enabled and visible
    const isDisabled = Boolean(candidate.attributes['disabled']) || candidate.attributes['aria-disabled'] === 'true';
    const isHidden = candidate.attributes['hidden'] === 'true' || candidate.attributes['aria-hidden'] === 'true';
    const actionability = isDisabled || isHidden ? 0.0 : 1.0;
    explanation.push(`Actionability A: ${actionability} (Disabled: ${isDisabled}, Hidden: ${isHidden})`);

    // 5. Historical Execution Reliability H: Neutral 0.5 baseline if unrecorded
    const historicalReliability = historicalScore !== undefined
      ? Math.max(0, Math.min(1.0, historicalScore))
      : 0.5;
    explanation.push(`Historical Execution Reliability H: ${historicalReliability}`);

    // 6. Volatile Implementation Dependence D (Penalizes hashed classes and dynamic IDs)
    let volatilePenalty = 0.0;
    const id = candidate.attributes['id'] ?? '';
    const classAttr = candidate.attributes['class'] ?? '';

    // Check for random hex/hash IDs e.g. "id-a1b2c3d4" or length > 16 hex
    if (/^[0-9a-f]{8,}$/i.test(id) || /^[a-z]+-[0-9a-f]{6,}$/i.test(id)) {
      volatilePenalty += 0.5;
    }

    // Check for CSS-in-JS hashed classes e.g. "css-1a2b3c" or "sc-xyz123"
    if (/css-[a-z0-9]+/i.test(classAttr) || /sc-[a-z0-9]+/i.test(classAttr)) {
      volatilePenalty += 0.4;
    }

    volatilePenalty = Math.min(1.0, volatilePenalty);
    explanation.push(`Volatile Penalty D: ${volatilePenalty}`);

    // Calculate final composite score S(L)
    const rawScore =
      weights.wU * uniqueness +
      weights.wI * identityMatch +
      weights.wM * semanticMatch +
      weights.wA * actionability +
      weights.wH * historicalReliability -
      weights.wD * volatilePenalty;

    const finalScore = Math.max(0, Math.min(1.0, parseFloat(rawScore.toFixed(3))));

    // Transformed confidence score via logistic sigmoid scaling
    const transformedScore = parseFloat((1 / (1 + Math.exp(-6 * (finalScore - 0.65)))).toFixed(3));

    return {
      score: finalScore,
      transformedScore,
      calibratedProbability: transformedScore, // Backward compatibility alias
      uniqueness,
      matchCount: matchingCount,
      identityMatch,
      semanticMatch,
      actionability,
      historicalReliability,
      historicalExecutionReliability: historicalReliability,
      volatilePenalty,
      explanation,
    };
  }
}
