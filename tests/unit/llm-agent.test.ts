import { describe, expect, it } from 'vitest';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';
import { buildEvidenceBundle } from '../../src/intelligence/evidence-bundle.js';
import { runRepairProposalAgent } from '../../src/intelligence/repair-agent.js';
import { AgentStepProvider, ProposalProvider } from '../../src/intelligence/model-provider.js';
import { parseAgentResponse } from '../../src/intelligence/llm-proposal.js';
import { validateLlmRepairPlan } from '../../src/intelligence/verified-llm-repair-workflow.js';
import { ProposalParseResult } from '../../src/intelligence/llm-proposal.js';

function context(errorMessage = 'Timeout waiting for locator("button.checkout")'): DiagnosticContext {
  return {
    playwrightVersion: '1.64.1',
    traceFormatVersion: 10,
    failedAction: { callId: 'action@1', action: 'page.click', selector: 'button.checkout', errorMessage },
    snapshots: { action: '<button role="button" aria-label="Checkout">Checkout</button>' },
    networkEvents: [],
    consoleEvents: [],
    evidenceCompleteness: { domAvailable: true, networkAvailable: true, sourceAvailable: true },
  };
}

function bundleFor(inputContext: DiagnosticContext, redactionComplete = true) {
  return buildEvidenceBundle({
    executionId: 'execution-1',
    testIdentity: 'checkout.spec.ts › checkout',
    context: inputContext,
    failureCategory: 'LOCATOR_DRIFT',
    redactionComplete,
    artifacts: [{ kind: 'trace', reference: 'trace.zip', redacted: true }],
  });
}

class FakeProvider implements ProposalProvider {
  public calls = 0;
  public constructor(private readonly result: ProposalParseResult) {}
  public async propose(): Promise<ProposalParseResult> {
    this.calls += 1;
    return this.result;
  }
}

class DualProvider extends FakeProvider implements AgentStepProvider {
  public stepCalls = 0;
  public async proposeStep(): ReturnType<AgentStepProvider['proposeStep']> {
    this.stepCalls += 1;
    return Promise.resolve(parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'STEP', status: 'CONTINUE',
      decision: 'INSPECT_EVIDENCE', confidence: 0.5, reasoningSummary: 'unused', evidenceReferences: [],
      action: { kind: 'inspect_evidence' }, requiredObservation: 'unused',
    })));
  }
}

describe('bounded LLM repair proposal agent', () => {
  it('normalizes recognized response-envelope metadata without accepting arbitrary fields', () => {
    const parsed = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'FINAL', status: 'ABSTAIN',
      classification: { category: 'AMBIGUOUS_MATCH', confidence: 0.9 },
      reasoningSummary: 'The controls cannot be distinguished safely.',
      evidenceReferences: [], humanApprovalRequired: true,
      callId: 'model-call-4', usage: { total_tokens: 123 },
    }));
    expect(parsed.isValid).toBe(true);
    expect(parsed.protocolMetadata).toMatchObject({ callId: 'model-call-4' });
    expect(parsed.normalizationNotes).toContain("Normalized recognized response envelope metadata 'callId'.");

    const unknown = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'FINAL', status: 'ABSTAIN',
      classification: { category: 'AMBIGUOUS_MATCH', confidence: 0.9 },
      reasoningSummary: 'The controls cannot be distinguished safely.',
      evidenceReferences: [], humanApprovalRequired: true, unsupportedField: true,
    }));
    expect(unknown.isValid).toBe(false);
    expect(unknown.errors.join(' ')).toContain('unsupportedField');
  });

  it('does not invoke a model for deterministic environment failures', async () => {
    const provider = new FakeProvider({ isValid: false, errors: ['must not be called'] });
    const failed = context('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8000/');
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed), provider });
    expect(result.state).toBe('DETERMINISTIC_ABSTAIN');
    expect(result.modelInvoked).toBe(false);
    expect(provider.calls).toBe(0);
  });

  it('can escalate incomplete locator evidence while keeping non-locator failures fail-closed', async () => {
    const provider = new FakeProvider({
      isValid: true,
      errors: [],
      proposal: {
        proposalVersion: '1',
        decision: 'PROPOSE',
        failureKind: 'LOCATOR_DRIFT',
        confidence: 0.82,
        reasoningSummary: 'A unique accessible replacement is present in the captured DOM.',
        operations: [{ kind: 'replace_locator', target: 'div', locator: "page.getByRole('button', { name: 'Checkout' })" }],
        requiredVerification: ['target test passes in an isolated worktree'],
        evidenceReferences: ['trace.zip'],
      },
    });
    const ambiguous = context('locator("div") resolved to 25 elements');
    ambiguous.failedAction.selector = 'div';
    const escalated = await runRepairProposalAgent({
      context: ambiguous,
      bundle: bundleFor(ambiguous),
      provider,
      allowModelEscalation: true,
    });
    expect(escalated.modelInvoked).toBe(true);
    expect(escalated.state).toBe('PROPOSAL_RECEIVED');
    expect(provider.calls).toBe(1);

    const backend = context('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8000/');
    const blocked = await runRepairProposalAgent({
      context: backend,
      bundle: bundleFor(backend),
      provider,
      allowModelEscalation: true,
    });
    expect(blocked.state).toBe('DETERMINISTIC_ABSTAIN');
    expect(provider.calls).toBe(1);
  });

  it('refuses to cross the provider boundary without a redaction attestation', async () => {
    const provider = new FakeProvider({ isValid: false, errors: ['must not be called'] });
    const failed = context();
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed, false), provider });
    expect(result.state).toBe('EVIDENCE_NOT_REDACTED');
    expect(provider.calls).toBe(0);
  });

  it('accepts a valid structured proposal but does not execute or promote it', async () => {
    const failed = context();
    const provider = new FakeProvider({
      isValid: true,
      errors: [],
      proposal: {
        proposalVersion: '1',
        decision: 'PROPOSE',
        failureKind: 'LOCATOR_DRIFT',
        confidence: 0.82,
        reasoningSummary: 'The replacement has a stable accessible role and name.',
        operations: [{ kind: 'replace_locator', target: 'button.checkout', locator: "getByRole('button', { name: 'Checkout' })" }],
        requiredVerification: ['target test passes in an isolated worktree'],
        evidenceReferences: ['trace.zip'],
      },
    });
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed), provider });
    expect(result.state).toBe('PROPOSAL_RECEIVED');
    expect(result.proposal?.operations[0]?.kind).toBe('replace_locator');
    expect(provider.calls).toBe(1);
  });

  it('uses the single-shot path when explicitly requested', async () => {
    const failed = context();
    const provider = new DualProvider({
      isValid: true,
      errors: [],
      proposal: {
        proposalVersion: '1', decision: 'PROPOSE', failureKind: 'LOCATOR_DRIFT', confidence: 0.9,
        reasoningSummary: 'Stable replacement.',
        operations: [{ kind: 'replace_locator', target: 'button.checkout', locator: "getByRole('button', { name: 'Checkout' })" }],
        requiredVerification: ['isolated target test'], evidenceReferences: [],
      },
    });
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed), provider, strategy: 'single-shot' });
    expect(result.state).toBe('PROPOSAL_RECEIVED');
    expect(provider.calls).toBe(1);
    expect(provider.stepCalls).toBe(0);
  });

  it('stops a repeated agent transition when the observation does not change', async () => {
    const failed = context();
    const provider = new DualProvider({ isValid: false, errors: [] });
    const result = await runRepairProposalAgent({
      context: failed,
      bundle: bundleFor(failed),
      provider,
      strategy: 'agent',
      actionHandlers: { inspect_evidence: async () => ({ status: 'unchanged' }) },
    });
    expect(result.state).toBe('AGENT_NO_PROGRESS');
    expect(result.steps).toHaveLength(2);
  });

  it('validates a multi-locator LLM plan without executing it', () => {
    const plan = validateLlmRepairPlan({
      proposalVersion: '1', decision: 'PROPOSE', failureKind: 'LOCATOR_DRIFT', confidence: 0.9,
      reasoningSummary: 'The login form locators changed together.',
      operations: [
        { kind: 'replace_locator', target: '#old-user', locator: "page.getByLabel('Username')" },
        { kind: 'replace_locator', target: '#old-submit', locator: "page.getByRole('button', { name: 'Login' })" },
      ],
      requiredVerification: ['all affected tests pass', 'assertions unchanged'], evidenceReferences: [],
    });
    expect(plan.isValid).toBe(true);
    expect(plan.workflowPlan?.steps).toHaveLength(2);
  });

  it('rejects a model proposal that conflicts with deterministic classification', async () => {
    const failed = context();
    const provider = new FakeProvider({
      isValid: true,
      errors: [],
      proposal: {
        proposalVersion: '1',
        decision: 'PROPOSE',
        failureKind: 'BACKEND_500',
        confidence: 0.99,
        reasoningSummary: 'Incorrectly claims a backend failure.',
        operations: [{ kind: 'replace_locator', target: 'button.checkout', locator: "getByRole('button', { name: 'Checkout' })" }],
        requiredVerification: ['target test passes in an isolated worktree'],
        evidenceReferences: ['trace.zip'],
      },
    });
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed), provider });
    expect(result.state).toBe('PROPOSAL_REJECTED');
    expect(result.errors[0]).toContain('conflicts');
  });

  it('rejects a locator proposal whose target is not the deterministic failed selector', async () => {
    const failed = context();
    const provider = new FakeProvider({
      isValid: true,
      errors: [],
      proposal: {
        proposalVersion: '1', decision: 'PROPOSE', failureKind: 'LOCATOR_DRIFT', confidence: 0.99,
        reasoningSummary: 'Incorrect target identity.',
        operations: [{ kind: 'replace_locator', target: 'action@1', locator: "page.getByRole('button', { name: 'Checkout' })" }],
        requiredVerification: ['isolated target test'], evidenceReferences: [],
      },
    });
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed), provider });
    expect(result.state).toBe('PROPOSAL_REJECTED');
    expect(result.errors[0]).toContain('does not match deterministic failed selector');
  });

  it('includes redacted diagnostic evidence in the model bundle', () => {
    const sensitive = context('Timeout waiting for locator("button.checkout") Bearer abc.def.ghi');
    sensitive.snapshots.action = '<input type="password" value="super-secret" /><button>Checkout</button>';
    const bundle = bundleFor(sensitive);
    expect(bundle.diagnostic?.failedAction.errorMessage).toContain('Bearer [REDACTED]');
    expect(bundle.diagnostic?.snapshots.action).toContain('value="[REDACTED]"');
    expect(bundle.diagnostic?.snapshots.action).not.toContain('super-secret');
    expect(bundle.redactionComplete).toBe(true);
  });
});
