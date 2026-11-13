import { ResolvedElement } from '../trace/snapshot-resolver.js';
import { CandidateExtractor } from '../selector/candidate-extractor.js';

export type DisambiguationStrategy =
  | 'UNIQUE_DIRECT_MATCH'
  | 'VISIBILITY_FILTER'
  | 'CONTAINER_ANCHOR'
  | 'LANDMARK_SECTION'
  | 'EXPLICIT_POSITIONAL_INTENT'
  | 'ABSTAIN_AMBIGUOUS';

export interface DisambiguationContext {
  originalSelector?: string | undefined;
  intendedAction?: string | undefined;
  testIntentText?: string | undefined;
  rootDom?: ResolvedElement | undefined;
}

export interface DisambiguationResult {
  strategy: DisambiguationStrategy;
  resolvedCandidate?: ResolvedElement;
  resolvedExpression?: string;
  scopedContainer?: ResolvedElement;
  containerAnchorText?: string;
  matchCount: number;
  explanation: string;
  confidence: number;
  isUnique: boolean;
}

export class LocatorDisambiguationEngine {
  /**
   * Evaluates multiple candidate elements through the evidence-based disambiguation hierarchy:
   * 1. Unique Direct Match (matchCount === 1)
   * 2. Visibility Filtering (filter { visible: true })
   * 3. Container Anchoring (tr, card, list item with distinguishing text)
   * 4. Landmark / Section Scoping (header, nav, main, dialog)
   * 5. Explicit Positional Intent (.first(), .nth() only if original test explicitly declared it)
   * 6. Safe Abstention (never guess positional intent)
   */
  public static disambiguate(
    candidates: ResolvedElement[],
    context: DisambiguationContext = {},
    pageProperty = 'page'
  ): DisambiguationResult {
    if (candidates.length === 0) {
      return {
        strategy: 'ABSTAIN_AMBIGUOUS',
        matchCount: 0,
        explanation: 'Zero matching candidate elements found.',
        confidence: 0,
        isUnique: false,
      };
    }

    // 1. Single Unique Candidate
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      const expr = CandidateExtractor.generateLocator(candidate, pageProperty);
      return {
        strategy: 'UNIQUE_DIRECT_MATCH',
        resolvedCandidate: candidate,
        resolvedExpression: expr,
        matchCount: 1,
        explanation: 'Candidate is strictly unique in the DOM snapshot (matchCount === 1).',
        confidence: 1.0,
        isUnique: true,
      };
    }

    // 2. Visibility Filtering
    const visibleCandidates = candidates.filter((c) => this.isElementVisible(c));
    if (visibleCandidates.length === 1) {
      const candidate = visibleCandidates[0]!;
      const baseExpr = CandidateExtractor.generateLocator(candidate, pageProperty);
      const resolvedExpression = `${baseExpr}.filter({ visible: true })`;
      return {
        strategy: 'VISIBILITY_FILTER',
        resolvedCandidate: candidate,
        resolvedExpression,
        matchCount: candidates.length,
        explanation: `Disambiguated by visibility: exactly 1 candidate is visible and interactive while ${candidates.length - 1} duplicate(s) are hidden or off-screen.`,
        confidence: 0.95,
        isUnique: true,
      };
    }

    // 3. Container Anchoring
    if (context.rootDom) {
      const anchorResult = this.attemptContainerAnchoring(candidates, context, pageProperty);
      if (anchorResult) {
        return anchorResult;
      }
    }

    // 4. Landmark / Section Scoping
    if (context.rootDom && (context.originalSelector || context.testIntentText)) {
      const landmarkResult = this.attemptLandmarkScoping(candidates, context, pageProperty);
      if (landmarkResult) {
        return landmarkResult;
      }
    }

    // 5. Explicit Positional Intent Verification
    const hasExplicitPositionalIntent = this.verifyExplicitPositionalIntent(context);
    if (hasExplicitPositionalIntent) {
      const candidate = candidates[0]!;
      const baseExpr = CandidateExtractor.generateLocator(candidate, pageProperty);
      const positionalMethod = hasExplicitPositionalIntent.method; // '.first()', '.last()', or '.nth(N)'
      const resolvedExpression = `${baseExpr}${positionalMethod}`;
      return {
        strategy: 'EXPLICIT_POSITIONAL_INTENT',
        resolvedCandidate: candidate,
        resolvedExpression,
        matchCount: candidates.length,
        explanation: `Verified explicit positional intent: original test or requirement explicitly specified ${positionalMethod}. Positional selection preserved with verified evidence.`,
        confidence: 0.90,
        isUnique: true,
      };
    }

    // 6. Safe Abstention (Never invent positional intent!)
    return {
      strategy: 'ABSTAIN_AMBIGUOUS',
      matchCount: candidates.length,
      explanation: `NON_UNIQUE_MATCH: Locator matches ${candidates.length} elements. Disambiguation failed across visibility filtering, container anchoring, and landmark scoping. In accordance with PIE safety invariants, positional intent (.first()/.nth()) is NOT invented. Safe abstention enforced.`,
      confidence: 0,
      isUnique: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal Resolution Strategies
  // ---------------------------------------------------------------------------

  private static isElementVisible(el: ResolvedElement): boolean {
    if (el.attributes['hidden'] === 'true' || el.attributes['hidden'] !== undefined) {
      return false;
    }
    if (el.attributes['aria-hidden'] === 'true') {
      return false;
    }
    const style = (el.attributes['style'] ?? '').toLowerCase();
    if (style.includes('display: none') || style.includes('visibility: hidden') || style.includes('opacity: 0')) {
      return false;
    }
    return true;
  }

  private static attemptContainerAnchoring(
    candidates: ResolvedElement[],
    context: DisambiguationContext,
    pageProperty: string
  ): DisambiguationResult | null {
    if (!context.rootDom) return null;

    // For each candidate, find its parent container chain
    const candidatePaths = candidates.map((c) => this.findPathToElement(context.rootDom!, c));

    // Try finding the closest enclosing container: tr, li, article, card
    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const path = candidatePaths[cIdx];
      if (!path || path.length < 2) continue;

      // Search bottom-up for a container
      for (let i = path.length - 2; i >= 0; i--) {
        const container = path[i]!;
        const isContainer =
          container.tag === 'tr' ||
          container.tag === 'li' ||
          container.tag === 'article' ||
          container.tag === 'section' ||
          (container.attributes['data-testid'] ?? '').includes('card') ||
          (container.attributes['data-testid'] ?? '').includes('item') ||
          (container.attributes['class'] ?? '').includes('card') ||
          (container.attributes['class'] ?? '').includes('item') ||
          container.role === 'row' ||
          container.role === 'listitem';

        if (isContainer) {
          // Check distinguishing text inside this container
          const containerText = this.getCleanText(container);
          if (containerText.length > 2 && containerText.length < 80) {
            // Check if other candidates' containers have different text
            const otherContainersHaveText = candidatePaths.some((otherPath, oIdx) => {
              if (oIdx === cIdx || !otherPath) return false;
              const otherContainer = otherPath[i];
              if (!otherContainer) return false;
              return this.getCleanText(otherContainer).includes(containerText);
            });

            // If this container text uniquely identifies this candidate's container:
            const intentMentionsContainer =
              (context.originalSelector && context.originalSelector.includes(containerText)) ||
              (context.testIntentText && context.testIntentText.includes(containerText));

            if (!otherContainersHaveText || intentMentionsContainer) {
              const candidate = candidates[cIdx]!;
              const innerPlan = CandidateExtractor.generateLocatorPlan(candidate);
              const innerExpr = CandidateExtractor.planToExpression(innerPlan, '').replace(/^\./, '');
              const containerTag = container.tag === 'tr' ? 'tr' : container.tag === 'li' ? 'li' : `[data-testid="${container.attributes['data-testid'] ?? container.tag}"]`;
              const escapedText = CandidateExtractor.escapeLocatorString(containerText);
              const resolvedExpression = `${pageProperty}.locator('${containerTag}').filter({ hasText: '${escapedText}' }).${innerExpr}`;

              return {
                strategy: 'CONTAINER_ANCHOR',
                resolvedCandidate: candidate,
                resolvedExpression,
                scopedContainer: container,
                containerAnchorText: containerText,
                matchCount: candidates.length,
                explanation: `Disambiguated via container anchoring: target is uniquely scoped within <${container.tag}> anchored by distinguishing text '${containerText}'.`,
                confidence: 0.92,
                isUnique: true,
              };
            }
          }
        }
      }
    }

    return null;
  }

  private static attemptLandmarkScoping(
    candidates: ResolvedElement[],
    context: DisambiguationContext,
    pageProperty: string
  ): DisambiguationResult | null {
    if (!context.rootDom) return null;

    const landmarks = ['header', 'nav', 'main', 'footer', 'aside', 'dialog'];
    const textToCheck = `${context.originalSelector ?? ''} ${context.testIntentText ?? ''}`.toLowerCase();

    for (const landmark of landmarks) {
      if (textToCheck.includes(landmark)) {
        // Find which candidate is inside this landmark
        for (const candidate of candidates) {
          const path = this.findPathToElement(context.rootDom, candidate);
          if (path && path.some((el) => el.tag === landmark || el.role === landmark)) {
            const innerPlan = CandidateExtractor.generateLocatorPlan(candidate);
            const innerExpr = CandidateExtractor.planToExpression(innerPlan, '').replace(/^\./, '');
            const resolvedExpression = `${pageProperty}.locator('${landmark}').${innerExpr}`;

            return {
              strategy: 'LANDMARK_SECTION',
              resolvedCandidate: candidate,
              resolvedExpression,
              matchCount: candidates.length,
              explanation: `Disambiguated via landmark scoping: target scoped to <${landmark}> based on original selector/intent context.`,
              confidence: 0.88,
              isUnique: true,
            };
          }
        }
      }
    }

    return null;
  }

  private static verifyExplicitPositionalIntent(
    context: DisambiguationContext
  ): { method: string; index: number } | null {
    const sel = context.originalSelector ?? '';
    const intent = (context.testIntentText ?? '').toLowerCase();

    // 1. Check original selector method calls
    if (sel.includes('.first()')) {
      return { method: '.first()', index: 0 };
    }
    if (sel.includes('.last()')) {
      return { method: '.last()', index: -1 };
    }
    const nthMatch = sel.match(/\.nth\((\d+)\)/);
    if (nthMatch && nthMatch[1] !== undefined) {
      const idx = parseInt(nthMatch[1], 10);
      return { method: `.nth(${idx})`, index: idx };
    }

    // 2. Check explicit test intent text
    if (intent.includes('first ') || intent.includes('1st ') || intent.includes('top item') || intent.includes('top result')) {
      return { method: '.first()', index: 0 };
    }
    if (intent.includes('second ') || intent.includes('2nd ')) {
      return { method: '.nth(1)', index: 1 };
    }
    if (intent.includes('third ') || intent.includes('3rd ')) {
      return { method: '.nth(2)', index: 2 };
    }
    if (intent.includes('last item') || intent.includes('last row')) {
      return { method: '.last()', index: -1 };
    }

    return null;
  }

  private static findPathToElement(
    root: ResolvedElement,
    target: ResolvedElement,
    currentPath: ResolvedElement[] = []
  ): ResolvedElement[] | null {
    const nextPath = [...currentPath, root];
    if (root === target) {
      return nextPath;
    }

    for (const child of root.children ?? []) {
      const found = this.findPathToElement(child, target, nextPath);
      if (found) return found;
    }

    return null;
  }

  private static getCleanText(el: ResolvedElement): string {
    if (el.text && el.text.trim().length > 0) {
      return el.text.trim();
    }
    // Collect child text
    const childTexts: string[] = [];
    for (const child of el.children ?? []) {
      if (child.text && child.text.trim().length > 0) {
        childTexts.push(child.text.trim());
      }
    }
    return childTexts.join(' ').trim();
  }
}
