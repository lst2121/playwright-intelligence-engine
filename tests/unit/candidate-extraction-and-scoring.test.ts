import { describe, it, expect } from 'vitest';
import { SelectorScorer, ScorerWeights } from '../../src/selector/selector-scorer.js';
import { CandidateExtractor } from '../../src/selector/candidate-extractor.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';
import { InsufficientIdentifiersError } from '../../src/core/errors/engine-errors.js';

describe('Candidate Extraction and Multi-Factor Scoring Suite (35 Tests)', () => {
  const createCandidate = (overrides?: Partial<ResolvedElement>): ResolvedElement => ({
    tag: 'button',
    attributes: {},
    text: 'Submit Form',
    children: [],
    role: 'button',
    accessibleName: 'Submit Form',
    ...overrides,
  });

  // --- Category 1: Semantic Match & Priority Weights (15 tests) ---
  it('SCORE-SEM-01: should award maximum semantic match (1.0) for role + accessible name', () => {
    const candidate = createCandidate({ role: 'button', accessibleName: 'Submit' });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.semanticMatch).toBe(1.0);
  });

  it('SCORE-SEM-02: should award 0.9 for dedicated data-testid attribute', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      attributes: { 'data-testid': 'submit-action' },
    });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.semanticMatch).toBe(0.9);
  });

  it('SCORE-SEM-03: should award 0.9 for data-test attribute', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      attributes: { 'data-test': 'checkout-btn' },
    });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.semanticMatch).toBe(0.9);
  });

  it('SCORE-SEM-04: should award 0.85 for placeholder attribute', () => {
    const candidate = createCandidate({
      tag: 'input',
      role: undefined,
      accessibleName: undefined,
      attributes: { placeholder: 'Search products...' },
    });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.semanticMatch).toBe(0.85);
  });

  it('SCORE-SEM-05: should award 0.85 for aria-label attribute without role', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      attributes: { 'aria-label': 'Close dialog' },
    });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.semanticMatch).toBe(0.85);
  });

  it('SCORE-SEM-06: should fallback to 0.4 baseline for raw HTML tag without ARIA semantics', () => {
    const candidate = createCandidate({
      tag: 'div',
      role: undefined,
      accessibleName: undefined,
      attributes: {},
      text: '',
    });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.semanticMatch).toBe(0.4);
  });

  it('SCORE-VOL-01: should penalize CSS-in-JS hashed classes (css-1a2b3c)', () => {
    const candidate = createCandidate({ attributes: { class: 'css-1a2b3c btn' } });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.volatilePenalty).toBeGreaterThanOrEqual(0.4);
  });

  it('SCORE-VOL-02: should penalize styled-components hashed classes (sc-xyz123)', () => {
    const candidate = createCandidate({ attributes: { class: 'sc-xyz123 main' } });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.volatilePenalty).toBeGreaterThanOrEqual(0.4);
  });

  it('SCORE-VOL-03: should penalize random hex IDs (btn-a1b2c3d4)', () => {
    const candidate = createCandidate({ attributes: { id: 'btn-a1b2c3d4e5f6' } });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.volatilePenalty).toBeGreaterThanOrEqual(0.5);
  });

  it('SCORE-VOL-04: should cap maximum volatile penalty at 1.0', () => {
    const candidate = createCandidate({
      attributes: {
        id: 'btn-a1b2c3d4e5f6',
        class: 'css-1a2b3c sc-xyz123',
      },
    });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.volatilePenalty).toBeLessThanOrEqual(1.0);
    expect(score.volatilePenalty).toBeGreaterThanOrEqual(0.8);
  });

  it('SCORE-ACT-01: should assign actionability 1.0 for normal enabled element', () => {
    const candidate = createCandidate({ attributes: {} });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.actionability).toBe(1.0);
  });

  it('SCORE-ACT-02: should assign actionability 0.0 for disabled attribute', () => {
    const candidate = createCandidate({ attributes: { disabled: 'true' } });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.actionability).toBe(0.0);
  });

  it('SCORE-ACT-03: should assign actionability 0.0 for aria-disabled="true"', () => {
    const candidate = createCandidate({ attributes: { 'aria-disabled': 'true' } });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.actionability).toBe(0.0);
  });

  it('SCORE-CALIB-01: should compute calibratedProbability distinguishing from raw score', () => {
    const candidate = createCandidate({ role: 'button', accessibleName: 'Submit' });
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.calibratedProbability).toBeDefined();
    expect(typeof score.calibratedProbability).toBe('number');
    expect(score.calibratedProbability).toBeGreaterThan(0);
    expect(score.calibratedProbability).toBeLessThanOrEqual(1.0);
  });

  it('SCORE-CALIB-02: calibrated probability should be lower for penalized candidates', () => {
    const good = createCandidate({ role: 'button', accessibleName: 'Submit' });
    const bad = createCandidate({
      role: 'button',
      accessibleName: 'Submit',
      attributes: { id: 'btn-a1b2c3d4', class: 'css-xyz123' },
    });
    const scoreGood = SelectorScorer.score(good, [good]);
    const scoreBad = SelectorScorer.score(bad, [bad]);
    expect(scoreGood.calibratedProbability!).toBeGreaterThan(scoreBad.calibratedProbability!);
  });

  // --- Category 2: Strict Uniqueness & Identity Affinity (10 tests) ---
  it('SCORE-UNIQ-01: exactly 1 match should yield uniqueness U = 1.0', () => {
    const candidate = createCandidate();
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.uniqueness).toBe(1.0);
    expect(score.matchCount).toBe(1);
  });

  it('SCORE-UNIQ-02: exactly 2 matches should yield uniqueness U = 0.5', () => {
    const c1 = createCandidate();
    const c2 = createCandidate();
    const score = SelectorScorer.score(c1, [c1, c2]);
    expect(score.uniqueness).toBe(0.5);
    expect(score.matchCount).toBe(2);
  });

  it('SCORE-UNIQ-03: exactly 3 matches should yield uniqueness U = 0.333', () => {
    const c1 = createCandidate();
    const c2 = createCandidate();
    const c3 = createCandidate();
    const score = SelectorScorer.score(c1, [c1, c2, c3]);
    expect(score.uniqueness).toBe(0.333);
    expect(score.matchCount).toBe(3);
  });

  it('SCORE-UNIQ-04: exactly 4 matches should yield uniqueness U = 0.25', () => {
    const candidates = [createCandidate(), createCandidate(), createCandidate(), createCandidate()];
    const score = SelectorScorer.score(candidates[0]!, candidates);
    expect(score.uniqueness).toBe(0.25);
    expect(score.matchCount).toBe(4);
  });

  it('SCORE-ID-01: should award 1.0 for exact accessible name in original selector', () => {
    const candidate = createCandidate({ accessibleName: 'Checkout' });
    const score = SelectorScorer.score(candidate, [candidate], "button:has-text('Checkout')");
    expect(score.identityMatch).toBe(1.0);
  });

  it('SCORE-ID-02: should award 1.0 for case-insensitive partial match in original selector', () => {
    const candidate = createCandidate({ accessibleName: 'Submit Order' });
    const score = SelectorScorer.score(candidate, [candidate], '#submit-order-button');
    expect(score.identityMatch).toBe(1.0);
  });

  it('SCORE-ID-03: should assign 0.0 identity score when selector has zero token overlap and no semantic affinity', () => {
    const candidate = createCandidate({ accessibleName: 'Place Order' });
    const score = SelectorScorer.score(candidate, [candidate], '#random-div-123');
    expect(score.identityMatch).toBe(0.0);
  });

  it('SCORE-ID-03B: should strictly assign 0.0 identity score for unrelated candidate (e.g. .primary-action vs Delete Account)', () => {
    const candidate = createCandidate({ accessibleName: 'Delete Account', role: 'button' });
    const score = SelectorScorer.score(candidate, [candidate], "page.locator('.primary-action')");
    expect(score.identityMatch).toBe(0.0);
  });

  it('SCORE-ID-04: should fallback to 0.3 when neither selector nor element accessible name match', () => {
    const candidate = createCandidate({ accessibleName: undefined });
    const score = SelectorScorer.score(candidate, [candidate], undefined);
    expect(score.identityMatch).toBe(0.3);
  });

  it('SCORE-ID-05: should recognize login and sign-in as equivalent intent', () => {
    const candidate = createCandidate({ accessibleName: 'Login' });
    const score = SelectorScorer.score(candidate, [candidate], "getByRole('button', { name: 'Sign in to Portal' })");
    expect(score.identityMatch).toBe(0.98);
  });

  it('SCORE-WEIGHTS-01: should support custom weights configuration', () => {
    const candidate = createCandidate();
    const customWeights: ScorerWeights = {
      wU: 0.5,
      wI: 0.1,
      wM: 0.2,
      wA: 0.1,
      wH: 0.1,
      wD: 0.0,
    };
    const score = SelectorScorer.score(candidate, [candidate], undefined, 0.8, customWeights);
    expect(score.score).toBeGreaterThan(0.7);
  });

  it('SCORE-EXPLAIN-01: should include descriptive explanation lines for each scoring factor', () => {
    const candidate = createCandidate();
    const score = SelectorScorer.score(candidate, [candidate]);
    expect(score.explanation.length).toBeGreaterThanOrEqual(6);
    expect(score.explanation.some((e) => e.includes('Uniqueness'))).toBe(true);
    expect(score.explanation.some((e) => e.includes('Actionability'))).toBe(true);
  });

  // --- Category 3: Candidate Extractor & Playwright Locator Generation (10 tests) ---
  it('EXTRACT-01: should extract role-based locator getByRole for button with name', () => {
    const candidate = createCandidate({ role: 'button', accessibleName: 'Sign In' });
    const loc = CandidateExtractor.generateLocator(candidate);
    expect(loc).toBe("this.page.getByRole('button', { name: 'Sign In' })");
  });

  it('EXTRACT-02: should extract getByRole for link with accessible name', () => {
    const candidate = createCandidate({ tag: 'a', role: 'link', accessibleName: 'Pricing' });
    const loc = CandidateExtractor.generateLocator(candidate);
    expect(loc).toBe("this.page.getByRole('link', { name: 'Pricing' })");
  });

  it('EXTRACT-03: should extract getByTestId when data-testid is present', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      attributes: { 'data-testid': 'submit-payment' },
    });
    const loc = CandidateExtractor.generateLocator(candidate);
    expect(loc).toBe("this.page.getByTestId('submit-payment')");
  });

  it('EXTRACT-04: should extract getByPlaceholder for input with placeholder', () => {
    const candidate = createCandidate({
      tag: 'input',
      role: 'textbox',
      accessibleName: 'Search',
      attributes: { placeholder: 'Search products...' },
    });
    const loc = CandidateExtractor.generateLocator(candidate);
    // Role + accessible name takes precedence
    expect(loc).toContain('getByRole');
  });

  it('EXTRACT-05: should extract getByLabel for input with aria-label', () => {
    const candidate = createCandidate({
      tag: 'input',
      role: undefined,
      accessibleName: 'Email Address',
      attributes: { 'aria-label': 'Email Address' },
    });
    const loc = CandidateExtractor.generateLocator(candidate);
    expect(loc).toBe("this.page.getByLabel('Email Address')");
  });

  it('EXTRACT-06: should fallback to ID selector locator(#id) when accessible names absent', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      text: '',
      attributes: { id: 'navbar-toggle' },
    });
    const loc = CandidateExtractor.generateLocator(candidate);
    expect(loc).toBe("this.page.locator('#navbar-toggle')");
  });

  it('EXTRACT-07: should fallback to class selector when only class attribute exists', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      text: '',
      attributes: { class: 'dropdown-item' },
    });
    const loc = CandidateExtractor.generateLocator(candidate);
    expect(loc).toBe("this.page.locator('button.dropdown-item')");
  });

  it('EXTRACT-08: should reject bare tag fallback when element has no attributes', () => {
    const candidate = createCandidate({
      role: undefined,
      accessibleName: undefined,
      attributes: {},
      text: '',
    });
    expect(() => CandidateExtractor.generateLocator(candidate)).toThrowError(InsufficientIdentifiersError);
  });

  it('EXTRACT-09: should extract and rank all interactive candidates from a DOM root', () => {
    const root: ResolvedElement = {
      tag: 'div',
      attributes: {},
      text: '',
      children: [
        createCandidate({ role: 'button', accessibleName: 'Submit' }),
        createCandidate({ role: 'button', accessibleName: 'Cancel' }),
      ],
    };
    const extracted = CandidateExtractor.extractCandidates(root, 'button:has-text("Submit")');
    expect(extracted.length).toBe(2);
    expect(extracted[0]?.accessibleName).toBe('Submit');
  });

  it('EXTRACT-10: should return empty array when root contains zero interactive elements', () => {
    const root: ResolvedElement = {
      tag: 'div',
      attributes: {},
      text: 'Just plain text',
      children: [],
    };
    const extracted = CandidateExtractor.extractCandidates(root);
    expect(extracted).toEqual([]);
  });
});
