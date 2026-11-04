import { ResolvedElement } from '../trace/snapshot-resolver.js';

export interface ScorerWeights {
  wU: number; // Uniqueness
  wI: number; // Identity Match
  wM: number; // Semantic Match (Role/Label over raw CSS)
  wA: number; // Actionability (visible/enabled)
  wH: number; // Historical Reliability
  wD: number; // Volatile Implementation Dependence penalty
}

export interface ScoreBreakdown {
  score: number;
  uniqueness: number;
  identityMatch: number;
  semanticMatch: number;
  actionability: number;
  historicalReliability: number;
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
   * Scores a candidate element against the multi-factor formula S(L) = w1*U + w2*I + w3*M + w4*A + w5*H - w6*D
   */
  public static score(
    candidate: ResolvedElement,
    allCandidates: ResolvedElement[],
    originalSelector?: string,
    historicalScore = 0.8,
    weights = SelectorScorer.DEFAULT_WEIGHTS
  ): ScoreBreakdown {
    const explanation: string[] = [];

    // 1. Uniqueness U: 1.0 if candidate is unique in tag+role+name combination among candidates
    const matchingCount = allCandidates.filter(
      (c) =>
        c.tag === candidate.tag &&
        c.role === candidate.role &&
        c.accessibleName === candidate.accessibleName
    ).length;
    const uniqueness = matchingCount === 1 ? 1.0 : matchingCount === 2 ? 0.5 : 0.2;
    explanation.push(`Uniqueness U: ${uniqueness} (${matchingCount} matching element(s) in scope)`);

    // 2. Identity Match I: Entity identity and parent/name affinity
    let identityMatch = 0.5;
    if (originalSelector && candidate.accessibleName) {
      const origLower = originalSelector.toLowerCase();
      const nameLower = candidate.accessibleName.toLowerCase();
      if (origLower.includes(nameLower) || nameLower.includes(origLower)) {
        identityMatch = 1.0;
      }
    } else if (candidate.accessibleName) {
      identityMatch = 0.8;
    }
    explanation.push(`Identity Match I: ${identityMatch}`);

    // 3. Semantic Match M: getByRole / getByLabel priority over raw CSS
    let semanticMatch = 0.4; // Base for raw HTML tag
    if (candidate.role && candidate.accessibleName) {
      semanticMatch = 1.0; // Perfect: Role + Accessible Name
    } else if (candidate.attributes['data-testid'] || candidate.attributes['data-test']) {
      semanticMatch = 0.9; // High: Dedicated Test ID
    } else if (candidate.attributes['placeholder'] || candidate.attributes['aria-label']) {
      semanticMatch = 0.85;
    }
    explanation.push(`Semantic Match M: ${semanticMatch} (Role: ${candidate.role ?? 'none'})`);

    // 4. Actionability A: Element is enabled and visible
    const isDisabled = Boolean(candidate.attributes['disabled']) || candidate.attributes['aria-disabled'] === 'true';
    const actionability = isDisabled ? 0.0 : 1.0;
    explanation.push(`Actionability A: ${actionability} (Disabled: ${isDisabled})`);

    // 5. Historical Reliability H: Time-decayed reliability
    const historicalReliability = Math.max(0, Math.min(1.0, historicalScore));
    explanation.push(`Historical Reliability H: ${historicalReliability}`);

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

    return {
      score: finalScore,
      uniqueness,
      identityMatch,
      semanticMatch,
      actionability,
      historicalReliability,
      volatilePenalty,
      explanation,
    };
  }
}

