import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SelectorScorer } from '../../src/selector/selector-scorer.js';
import { AbstentionPolicy, ScoredCandidate } from '../../src/selector/abstention-policy.js';
import { StabilityLedger } from '../../src/memory/stability-ledger.js';
import { TestGenerator } from '../../src/generator/test-generator.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('Phase 3 Intelligence & Stability Tests', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-phase3');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should calculate multi-factor score S(L) prioritizing user-centric roles over volatile classes', () => {
    const roleCandidate: ResolvedElement = {
      tag: 'button',
      attributes: { class: 'btn btn-primary' },
      text: 'Submit Form',
      children: [],
      role: 'button',
      accessibleName: 'Submit Form',
    };

    const volatileCandidate: ResolvedElement = {
      tag: 'button',
      attributes: { id: 'btn-a1b2c3d4e5f6', class: 'css-1a2b3c' },
      text: 'Submit',
      children: [],
    };

    const candidates = [roleCandidate, volatileCandidate];

    const scoreRole = SelectorScorer.score(roleCandidate, candidates, 'button.submit');
    const scoreVolatile = SelectorScorer.score(volatileCandidate, candidates, 'button.submit');

    expect(scoreRole.score).toBeGreaterThan(scoreVolatile.score);
    expect(scoreRole.semanticMatch).toBe(1.0); // Perfect Role + Accessible Name
    expect(scoreVolatile.volatilePenalty).toBeGreaterThan(0.5); // Hashed ID + css-in-js class penalized
  });

  it('should enforce AbstentionPolicy when candidate scores are ambiguous or low', () => {
    const candidateA: ResolvedElement = {
      tag: 'button',
      attributes: {},
      text: 'Cancel',
      children: [],
      role: 'button',
      accessibleName: 'Cancel',
    };
    const candidateB: ResolvedElement = {
      tag: 'button',
      attributes: {},
      text: 'Close',
      children: [],
      role: 'button',
      accessibleName: 'Close',
    };

    const scoredA: ScoredCandidate = {
      element: candidateA,
      breakdown: {
        score: 0.81,
        uniqueness: 1.0,
        identityMatch: 0.8,
        semanticMatch: 1.0,
        actionability: 1.0,
        historicalReliability: 0.8,
        volatilePenalty: 0.0,
        explanation: [],
      },
    };

    const scoredB: ScoredCandidate = {
      element: candidateB,
      breakdown: {
        score: 0.80, // Delta is only 0.01 (< AMBIGUITY_DELTA_THRESHOLD 0.08)
        uniqueness: 1.0,
        identityMatch: 0.8,
        semanticMatch: 1.0,
        actionability: 1.0,
        historicalReliability: 0.8,
        volatilePenalty: 0.0,
        explanation: [],
      },
    };

    const decision = AbstentionPolicy.evaluate([scoredA, scoredB]);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.reason).toContain('Ambiguous match');
  });

  it('should persist selector historical reliability in StabilityLedger', async () => {
    const ledger = new StabilityLedger(tmpDir);
    await ledger.init();

    const selector = "this.page.getByRole('button', { name: 'Save' })";

    // Initial score default
    expect(ledger.getScore(selector)).toBe(0.8);

    // Record 5 successes
    for (let i = 0; i < 5; i++) {
      await ledger.recordSuccess(selector);
    }
    expect(ledger.getScore(selector)).toBe(1.0);

    // Record failure
    await ledger.recordFailure(selector, 'LOCATOR_DRIFT');
    // Score: 5 / (5 + 1*2) = 5 / 7 = 0.714
    expect(ledger.getScore(selector)).toBe(0.714);
  });

  it('should generate production-grade Page Object and Spec with TestGenerator', () => {
    const result = TestGenerator.generateSuite(
      'UserLogin',
      [
        { action: 'fill', name: 'Username', value: 'admin' },
        { action: 'click', role: 'button', name: 'Login' },
        { action: 'assert-visible', role: 'heading', name: 'Dashboard' },
      ],
      'https://opensource-demo.orangehrmlive.com'
    );

    expect(result.pageObjectName).toBe('UserLoginPage');
    expect(result.pageObjectCode).toContain('export class UserLoginPage');
    expect(result.pageObjectCode).toContain("this.page.getByRole('button', { name: 'Login' })");
    expect(result.specCode).toContain("await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();");
  });
});

