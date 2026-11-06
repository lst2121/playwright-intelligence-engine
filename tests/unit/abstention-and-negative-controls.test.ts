import { describe, it, expect } from 'vitest';
import { AbstentionPolicy, ScoredCandidate } from '../../src/selector/abstention-policy.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('Abstention Policy and Negative Controls Suite (35 Tests)', () => {
  const createScoredCandidate = (overrides?: Partial<ScoredCandidate>): ScoredCandidate => {
    const el: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Save Changes',
      attributes: { id: 'save-btn' },
      text: 'Save Changes',
      children: [],
    };

    return {
      element: el,
      breakdown: {
        score: 0.88,
        transformedScore: 0.91,
        calibratedProbability: 0.91,
        uniqueness: 1.0,
        matchCount: 1,
        identityMatch: 1.0,
        semanticMatch: 1.0,
        actionability: 1.0,
        historicalReliability: 0.8,
        historicalExecutionReliability: 0.8,
        volatilePenalty: 0.0,
        explanation: ['All factors optimal'],
      },
      intendedAction: 'click',
      ...overrides,
    };
  };

  // --- Category 1: Strict Uniqueness Gate (matchCount === 1) (10 tests) ---
  it('UNIQ-GATE-01: candidate with matchCount === 1 must PASS strict uniqueness', () => {
    const candidate = createScoredCandidate();
    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
    expect(decision.stage).toBe('AUTHORIZED');
  });

  it('UNIQ-GATE-02: candidate with matchCount === 2 must ABSTAIN (Boundary Bug Prevention)', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.matchCount = 2;
    candidate.breakdown.uniqueness = 0.5;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('STRICT_UNIQUENESS');
    expect(decision.reason).toContain('NON_UNIQUE_CANDIDATE');
    expect(decision.reason).toContain('matches 2 elements');
  });

  it('UNIQ-GATE-03: candidate with matchCount === 3 must ABSTAIN', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.matchCount = 3;
    candidate.breakdown.uniqueness = 0.333;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('STRICT_UNIQUENESS');
    expect(decision.reason).toContain('matches 3 elements');
  });

  it('UNIQ-GATE-04: candidate with matchCount === 10 must ABSTAIN', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.matchCount = 10;
    candidate.breakdown.uniqueness = 0.1;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('STRICT_UNIQUENESS');
  });

  it('UNIQ-GATE-05: candidate with matchCount === 2 but parentScopeVerified === true must PASS', () => {
    const candidate = createScoredCandidate({ parentScopeVerified: true });
    candidate.breakdown.matchCount = 2;
    candidate.breakdown.uniqueness = 0.5;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
    expect(decision.stage).toBe('AUTHORIZED');
  });

  it('UNIQ-GATE-06: candidate with matchCount === 5 but parentScopeVerified === true must PASS', () => {
    const candidate = createScoredCandidate({ parentScopeVerified: true });
    candidate.breakdown.matchCount = 5;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('UNIQ-GATE-07: candidate with matchCount 0 must ABSTAIN', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.matchCount = 0;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('STRICT_UNIQUENESS');
  });

  it('UNIQ-GATE-08: should record NON_UNIQUE_CANDIDATE in reason string', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.matchCount = 2;
    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.reason).toContain('NON_UNIQUE_CANDIDATE');
  });

  it('UNIQ-GATE-09: runner-up non-uniqueness should not block top unique candidate', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.9, matchCount: 1 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.7, matchCount: 3 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(false);
    expect(decision.selectedCandidate).toBe(top);
  });

  it('UNIQ-GATE-10: empty candidate array must ABSTAIN on initial check', () => {
    const decision = AbstentionPolicy.evaluate([]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.reason).toContain('Zero matching candidate');
  });

  // --- Category 2: Ambiguity Delta Gate (threshold >= 0.08) (10 tests) ---
  it('AMBIG-01: delta of 0.01 between top two candidates must ABSTAIN', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.85 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.84 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('AMBIGUITY_DELTA');
    expect(decision.reason).toContain('Ambiguous match');
  });

  it('AMBIG-02: delta of 0.05 (< 0.08) must ABSTAIN', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.85 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.80 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('AMBIGUITY_DELTA');
  });

  it('AMBIG-03: delta of 0.079 (< 0.08) must ABSTAIN', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.879 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.80 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('AMBIGUITY_DELTA');
  });

  it('AMBIG-03B: strong semantic identity separation may resolve a close score tie', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.888, identityMatch: 0.95 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.85, identityMatch: 0.8 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(false);
    expect(decision.selectedCandidate).toBe(top);
  });

  it('AMBIG-04: delta of exactly 0.08 must PASS ambiguity check', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.88 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.80 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('AMBIG-05: delta of 0.15 (> 0.08) must PASS ambiguity check', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.95 } });
    const runnerUp = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.80 } });

    const decision = AbstentionPolicy.evaluate([top, runnerUp]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('AMBIG-06: single candidate must PASS ambiguity check automatically', () => {
    const top = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.85 } });
    const decision = AbstentionPolicy.evaluate([top]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('AMBIG-07: three candidates with ambiguous runner-up must ABSTAIN', () => {
    const c1 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.82 } });
    const c2 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.81 } });
    const c3 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.70 } });

    const decision = AbstentionPolicy.evaluate([c1, c2, c3]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('AMBIGUITY_DELTA');
  });

  it('AMBIG-08: three candidates with distinct top winner must PASS', () => {
    const c1 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.92 } });
    const c2 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.80 } });
    const c3 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.75 } });

    const decision = AbstentionPolicy.evaluate([c1, c2, c3]);
    expect(decision.shouldAbstain).toBe(false);
    expect(decision.selectedCandidate).toBe(c1);
  });

  it('AMBIG-09: candidates with identical scores (delta 0.00) must ABSTAIN', () => {
    const c1 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.88 } });
    const c2 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.88 } });

    const decision = AbstentionPolicy.evaluate([c1, c2]);
    expect(decision.shouldAbstain).toBe(true);
  });

  it('AMBIG-10: should report delta value in abstention explanation string', () => {
    const c1 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.83 } });
    const c2 = createScoredCandidate({ breakdown: { ...createScoredCandidate().breakdown, score: 0.80 } });

    const decision = AbstentionPolicy.evaluate([c1, c2]);
    expect(decision.reason).toContain('delta: 0.030');
  });

  // --- Category 3: Action Semantics, Supported Elements & Confidence (15 tests) ---
  it('SEM-GATE-01: click action on non-clickable paragraph <p> must ABSTAIN', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'p', attributes: {}, text: 'Click me', children: [] },
      intendedAction: 'click',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('ACTION_SEMANTICS');
    expect(decision.reason).toContain('cannot be safely dispatched to non-clickable element <p>');
  });

  it('SEM-GATE-02: click action on non-clickable heading <h1> must ABSTAIN', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'h1', attributes: {}, text: 'Heading', children: [] },
      intendedAction: 'click',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('ACTION_SEMANTICS');
  });

  it('SEM-GATE-03: fill action on non-input button element must ABSTAIN', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'button', attributes: {}, text: 'Submit', children: [] },
      intendedAction: 'fill',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('ACTION_SEMANTICS');
    expect(decision.reason).toContain('fill/type action requires input or textbox element');
  });

  it('SEM-GATE-04: fill action on <div> without contenteditable must ABSTAIN', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'div', attributes: {}, text: '', children: [] },
      intendedAction: 'fill',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('ACTION_SEMANTICS');
  });

  it('SEM-GATE-05: fill action on input tag must PASS', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'input', role: 'textbox', accessibleName: 'Username', attributes: {}, text: '', children: [] },
      intendedAction: 'fill',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('SEM-GATE-06: fill action on textarea tag must PASS', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'textarea', role: 'textbox', accessibleName: 'Bio', attributes: {}, text: '', children: [] },
      intendedAction: 'fill',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('SEM-GATE-07: fill action on div with contenteditable="true" must PASS', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'div', attributes: { contenteditable: 'true' }, text: '', children: [] },
      intendedAction: 'fill',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('SEM-GATE-08: click action on button element must PASS', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'button', attributes: {}, text: 'Pay', children: [] },
      intendedAction: 'click',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('SEM-GATE-09: click action on anchor <a> tag with href must PASS', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'a', attributes: { href: '/help' }, text: 'Help', children: [] },
      intendedAction: 'click',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('SEM-GATE-10: click action on element with role="tab" must PASS', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'div', role: 'tab', attributes: {}, text: 'Profile', children: [] },
      intendedAction: 'click',
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('CONF-GATE-01: candidate with score 0.69 (< 0.70 threshold) must ABSTAIN', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.score = 0.69;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('SCORE_CONFIDENCE');
    expect(decision.reason).toContain('below minimum safety threshold');
  });

  it('CONF-GATE-02: candidate with score 0.50 must ABSTAIN', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.score = 0.50;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('SCORE_CONFIDENCE');
  });

  it('CONF-GATE-03: candidate with score exactly 0.70 must PASS confidence gate', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.score = 0.70;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(false);
  });

  it('ID-GATE-01: candidate with identityMatch 0.3 (< 0.4) must ABSTAIN', () => {
    const candidate = createScoredCandidate();
    candidate.breakdown.identityMatch = 0.3;

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('TARGET_IDENTITY');
    expect(decision.reason).toContain('Target identity mismatch');
  });

  it('SUPP-GATE-01: unknown custom tag <custom-widget> without ARIA role must ABSTAIN', () => {
    const candidate = createScoredCandidate({
      element: { tag: 'custom-widget', attributes: {}, text: '', children: [] },
    });

    const decision = AbstentionPolicy.evaluate([candidate]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.stage).toBe('SUPPORTED_ELEMENT');
    expect(decision.reason).toContain('Unsupported DOM tag');
  });
});

