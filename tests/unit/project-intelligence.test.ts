import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StabilityLedger } from '../../src/memory/stability-ledger.js';
import { loadProjectIntelligence, recordProjectFailure, recordProjectSemanticVerification, recordProjectRepairAccepted, getHistoricalSelectorScore } from '../../src/intelligence/project-intelligence.js';
import { writeRepositoryProfile } from '../../src/intelligence/repository-profile.js';
import { RepairCandidateRanker } from '../../src/selector/repair-candidate-ranker.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('project-scoped intelligence', () => {
  it('uses repository conventions and selector history in repair ranking', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-intelligence-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      devDependencies: { '@playwright/test': '^1.60.0' },
    }), 'utf8');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}', 'utf8');
    await fs.mkdir(path.join(root, 'pages'), { recursive: true });
    await fs.writeFile(path.join(root, 'pages', 'LoginPage.ts'), `export class LoginPage { submit = this.page.getByRole('button', { name: 'Submit' }); }`, 'utf8');
    await writeRepositoryProfile(root, {
      version: 1,
      generatedAt: new Date().toISOString(),
      repository: { name: 'intelligence-test', root, packageManager: 'npm', scripts: {} },
      structure: { testFiles: 1, pageObjectFiles: 1, fixtureFiles: 0, configFiles: [], usesPageObjects: true, usesCustomFixtures: false, usesApiHelpers: false, usesStorageState: false },
      locatorConventions: { getByRole: 3, getByTestId: 0, getByLabel: 0, getByText: 0, locator: 0, cssOrXpath: 0, preferred: 'getByRole' },
      testConventions: { tags: [], usesDescribeBlocks: false, usesTestSteps: false, usesAssertions: true },
      domainTerms: ['login'],
      evidence: ['Page Object files detected'],
    });

    const candidate: ResolvedElement = {
      tag: 'button',
      attributes: {},
      text: 'Submit',
      children: [],
      role: 'button',
      accessibleName: 'Submit',
    };
    const locator = "page.getByRole('button', { name: 'Submit' })";
    const ledger = new StabilityLedger(root);
    await ledger.recordSuccess(locator);
    const intelligence = await loadProjectIntelligence(root);
    const ranked = RepairCandidateRanker.rank([candidate], 'button.submit', 'click', intelligence);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.breakdown.historicalReliability).toBe(1);
    expect(ranked[0]?.breakdown.conventionAlignment).toBe(1);
    expect(ranked[0]?.locatorExpression).toContain('getByRole');
  });

  it('uses observed locator distribution as a bounded convention signal', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-convention-distribution-'));
    await writeRepositoryProfile(root, {
      version: 1,
      generatedAt: new Date().toISOString(),
      repository: { name: 'distribution-test', root, packageManager: 'npm', scripts: {} },
      structure: { testFiles: 2, pageObjectFiles: 1, fixtureFiles: 0, configFiles: [], usesPageObjects: true, usesCustomFixtures: false, usesApiHelpers: false, usesStorageState: false },
      locatorConventions: { getByRole: 9, getByTestId: 1, getByLabel: 0, getByText: 0, locator: 0, cssOrXpath: 0, preferred: 'getByRole' },
      testConventions: { tags: [], usesDescribeBlocks: false, usesTestSteps: false, usesAssertions: true },
      domainTerms: [],
      evidence: [],
    });
    const intelligence = await loadProjectIntelligence(root);
    const roleCandidate: ResolvedElement = { tag: 'button', attributes: {}, text: 'Submit', children: [], role: 'button', accessibleName: 'Submit' };
    const testIdCandidate: ResolvedElement = { tag: 'button', attributes: { 'data-testid': 'submit' }, text: 'Submit', children: [] };
    const ranked = RepairCandidateRanker.rank([roleCandidate, testIdCandidate], 'button.submit', 'click', intelligence);

    expect(ranked[0]?.locatorExpression).toContain('getByRole');
    expect(ranked[0]?.breakdown.conventionAlignment).toBeGreaterThan(ranked[1]?.breakdown.conventionAlignment ?? 0);
  });

  it('learns locator failures but does not penalize selectors for backend failures', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-learning-'));
    const selector = "this.page.getByRole('button', { name: 'Submit' })";
    await recordProjectFailure(root, selector, 'LOCATOR_DRIFT');
    await recordProjectFailure(root, selector, 'BACKEND_500');
    const ledger = new StabilityLedger(root);
    await ledger.init();
    const record = ledger.getSnapshot().selectors[selector];
    expect(record?.failures).toBe(1);
    expect(record?.failureCategories).toEqual(['LOCATOR_DRIFT']);
  });

  it('records verified and operator-accepted repairs in the project ledger', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-repair-learning-'));
    const selector = "this.page.getByRole('button', { name: 'Confirm' })";

    await recordProjectSemanticVerification(root, selector);
    await recordProjectRepairAccepted(root, selector);

    const ledger = new StabilityLedger(root);
    await ledger.init();
    const record = ledger.getSnapshot().selectors[selector];
    expect(record?.semanticVerifications).toBe(1);
    expect(record?.repairsAccepted).toBe(1);
    expect(record?.successes).toBe(1);
    expect(record?.reliabilityScore).toBe(1);
  });

  it('matches Page Object selector history across page-property prefixes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-prefix-learning-'));
    const pageObjectSelector = "this.page.getByRole('button', { name: 'Confirm' })";
    const generatedSelector = "page.getByRole('button', { name: 'Confirm' })";
    const ledger = new StabilityLedger(root);
    await ledger.recordSuccess(pageObjectSelector);
    const intelligence = await loadProjectIntelligence(root);

    expect(getHistoricalSelectorScore(intelligence, generatedSelector)).toBe(1);
    expect(getHistoricalSelectorScore(intelligence, pageObjectSelector)).toBe(1);
  });
});
