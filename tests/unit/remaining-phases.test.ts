import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDiagnosticDecision } from '../../src/diagnostics/diagnostic-contract.js';
import { parseLlmRepairProposal } from '../../src/intelligence/llm-proposal.js';
import { OpenAiCompatibleProposalProvider } from '../../src/intelligence/model-provider.js';
import { renderCiSummary, renderGitHubAnnotation } from '../../src/integrations/ci-summary.js';
import { AuditLog } from '../../src/governance/audit-log.js';
import { StabilityLedger } from '../../src/memory/stability-ledger.js';
import { evaluateVerificationGates } from '../../src/repair/verification-gates.js';
import { validateRepairOperation } from '../../src/repair/repair-operations.js';
import { compileWorkflowPlan } from '../../src/repair/workflow-plan.js';
import { FailureClassifier } from '../../src/diagnostics/failure-classifier.js';
import { inspectRepository } from '../../src/evaluation/repository-inspector.js';
import { RepositoryRunner } from '../../src/evaluation/repository-runner.js';

describe('Remaining product phase contracts', () => {
  it('creates an abstaining diagnostic decision with missing evidence', () => {
    const context = {
      playwrightVersion: '1.64.1',
      traceFormatVersion: 10,
      failedAction: { callId: 'a1', action: 'click', selector: '#submit', errorMessage: 'timeout' },
      snapshots: {},
      networkEvents: [],
      consoleEvents: [],
      evidenceCompleteness: { domAvailable: false, networkAvailable: false, sourceAvailable: false },
    } as any;
    const classification = FailureClassifier.classify(context);
    const decision = createDiagnosticDecision(context, classification);
    expect(decision.shouldAbstain).toBe(true);
    expect(decision.missingEvidence).toContain('DOM or accessibility snapshot');
    expect(decision.provenance.failedActionId).toBe('a1');
  });

  it('accepts a valid structured LLM locator proposal', () => {
    const result = parseLlmRepairProposal(JSON.stringify({
      proposalVersion: '1',
      decision: 'PROPOSE',
      failureKind: 'LOCATOR_DRIFT',
      confidence: 0.92,
      reasoningSummary: 'The unique button retained the intended action but changed its accessible name.',
      operations: [{ kind: 'replace_locator', target: 'Checkout.submit', locator: "this.page.getByRole('button', { name: 'Confirm' })" }],
      requiredVerification: ['count_equals_one', 'target_test_passes', 'assertions_unchanged'],
      evidenceReferences: ['screenshot:failure.png', 'dom:action'],
    }));
    expect(result.isValid).toBe(true);
    expect(result.proposal?.operations[0]?.kind).toBe('replace_locator');
  });

  it('rejects an LLM proposal that abstains while requesting mutation', () => {
    const result = parseLlmRepairProposal({
      proposalVersion: '1',
      decision: 'ABSTAIN',
      failureKind: 'BUSINESS_DEFECT',
      confidence: 0.99,
      reasoningSummary: 'The backend returned an invalid total.',
      operations: [{ kind: 'replace_locator', target: 'Cart.total', locator: 'this.page.getByText(\'99\')' }],
      requiredVerification: ['business_oracle'],
      evidenceReferences: [],
    });
    expect(result.isValid).toBe(false);
  });

  it('requires fields for workflow operations', () => {
    expect(validateRepairOperation({ kind: 'add_frame_scope' }).isValid).toBe(false);
    expect(validateRepairOperation({ kind: 'add_frame_scope', target: 'Payment.submit', frameLocator: 'iframe[title="Payment"]' }).isValid).toBe(true);
  });

  it('compiles only validated workflow operations', () => {
    const plan = compileWorkflowPlan([
      { kind: 'replace_locator', target: 'Checkout.submit', locator: "this.page.getByRole('button', { name: 'Confirm' })" },
      { kind: 'add_frame_scope', target: 'Checkout.card', frameLocator: 'iframe[title="Card"]' },
    ]);
    expect(plan.status).toBe('EXECUTABLE');
    expect(plan.steps).toHaveLength(2);

    const rejected = compileWorkflowPlan([{ kind: 'replace_locator', target: 'x', locator: 'this.page.evaluate(() => process.env.SECRET)' }]);
    expect(rejected.status).toBe('ABSTAIN');
  });

  it('accepts a proposal from an OpenAI-compatible provider only through the PIE schema', async () => {
    const provider = new OpenAiCompatibleProposalProvider({
      endpoint: 'http://localhost:9999/v1/chat/completions',
      model: 'test-model',
      apiKey: 'test-key',
      fetchImpl: (async (_input, init) => {
        expect(init?.headers).toBeDefined();
        const body = JSON.parse(String(init?.body));
        expect(body.response_format.type).toBe('json_object');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({
              proposalVersion: '1',
              decision: 'ABSTAIN',
              failureKind: 'BACKEND_500',
              confidence: 0.99,
              reasoningSummary: 'The backend failed.',
              operations: [{ kind: 'abstain', reason: 'Application failure.' }],
              requiredVerification: ['business_oracle'],
              evidenceReferences: [],
            }) } }],
          }),
        } as Response;
      }) as typeof fetch,
    });
    const result = await provider.propose({
      bundleId: 'b1',
      executionId: 'e1',
      testIdentity: 'checkout.spec.ts:1',
      redactionComplete: true,
      sourceContext: [],
      artifacts: [],
      limitations: [],
    });
    expect(result.isValid).toBe(true);
    expect(result.proposal?.decision).toBe('ABSTAIN');
  });

  it('fails closed when verification gates are not satisfied', () => {
    const result = evaluateVerificationGates({
      executionPassed: true,
      targetIdentityPreserved: true,
      assertionsIntact: true,
      fixturesIntact: true,
      diffAllowlistPassed: true,
      regressionPassed: true,
      operationValidated: true,
      businessOracleStatus: 'unavailable',
      requireBusinessOracle: true,
    });
    expect(result.isPromotable).toBe(false);
    expect(result.failedGates).toContain('businessOracleRequired');
  });

  it('renders CI summaries and annotations', () => {
    const summary = renderCiSummary({
      status: 'ABSTAIN',
      category: 'BACKEND_500',
      reason: 'Application failure detected; no code repair proposed.',
      artifacts: ['artifacts/trace.zip'],
      repairProposalAvailable: false,
      verifiedRepair: false,
    });
    expect(summary).toContain('PIE result: ABSTAIN');
    expect(summary).toContain('artifacts/trace.zip');
    expect(renderGitHubAnnotation({
      status: 'ABSTAIN',
      reason: 'Application failure',
      artifacts: [],
      repairProposalAvailable: false,
      verifiedRepair: false,
    })).toContain('::warning');
  });

  it('maintains a tamper-evident audit chain', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-audit-'));
    const audit = new AuditLog(tempDir);
    await audit.append({ actor: 'system', action: 'diagnose', outcome: 'allowed', metadata: { category: 'LOCATOR_DRIFT' } });
    await audit.append({ actor: 'operator', action: 'promote', outcome: 'allowed', target: 'pages/Checkout.ts' });
    expect((await audit.verify()).valid).toBe(true);
  });

  it('records semantic verification and accepted repairs in the stability ledger', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-ledger-'));
    const ledger = new StabilityLedger(tempDir);
    await ledger.recordSemanticVerification('role=button[name=Submit]');
    await ledger.recordRepairAccepted('role=button[name=Submit]');
    const snapshot = ledger.getSnapshot();
    expect(snapshot.selectors['role=button[name=Submit]']?.semanticVerifications).toBe(1);
    expect(snapshot.selectors['role=button[name=Submit]']?.repairsAccepted).toBe(1);
  });

  it('inspects a repository without modifying it', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-repo-'));
    await fs.mkdir(path.join(tempDir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({
      license: 'MIT',
      devDependencies: { '@playwright/test': '^1.50.0' },
      scripts: { test: 'playwright test', dev: 'vite' },
    }), 'utf8');
    await fs.writeFile(path.join(tempDir, 'playwright.config.ts'), 'export default {};', 'utf8');
    await fs.writeFile(path.join(tempDir, 'tests', 'login.spec.ts'), 'test("login", async () => {});', 'utf8');
    const manifest = await inspectRepository(tempDir);
    expect(manifest.status).toBe('DISCOVERED');
    expect(manifest.hasPlaywrightConfig).toBe(true);
    expect(manifest.testFiles).toBe(1);
    expect(manifest.license).toBe('MIT');
  });

  it('runs only allowlisted repository commands with bounded output', async () => {
    const result = await RepositoryRunner.runCommand({
      name: 'test-repository',
      root: process.cwd(),
      packageManager: 'npm',
      license: 'MIT',
      hasPlaywrightConfig: false,
      playwrightConfigs: [],
      testFiles: 0,
      pageObjectFiles: 0,
      fixtureFiles: 0,
      hasDocker: false,
      hasLocalWebServerHint: false,
      scripts: {},
      status: 'DISCOVERED',
      limitations: [],
    }, process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { timeoutMs: 10_000 });
    expect(result.status).toBe('PASS');
    expect(result.stdout.trim().length).toBeGreaterThan(0);

    const blocked = await RepositoryRunner.runCommand({
      name: 'test-repository',
      root: process.cwd(),
      packageManager: 'npm',
      license: 'MIT',
      hasPlaywrightConfig: false,
      playwrightConfigs: [],
      testFiles: 0,
      pageObjectFiles: 0,
      fixtureFiles: 0,
      hasDocker: false,
      hasLocalWebServerHint: false,
      scripts: {},
      status: 'DISCOVERED',
      limitations: [],
    }, 'powershell', ['-NoProfile'], { timeoutMs: 10_000 });
    expect(blocked.status).toBe('BLOCKED');
  });
});
