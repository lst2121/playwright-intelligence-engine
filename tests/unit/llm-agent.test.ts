import { describe, expect, it } from 'vitest';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';
import { buildEvidenceBundle } from '../../src/intelligence/evidence-bundle.js';
import { runRepairProposalAgent } from '../../src/intelligence/repair-agent.js';
import { ProposalProvider } from '../../src/intelligence/model-provider.js';
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

describe('bounded LLM repair proposal agent', () => {
  it('does not invoke a model for deterministic environment failures', async () => {
    const provider = new FakeProvider({ isValid: false, errors: ['must not be called'] });
    const failed = context('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8000/');
    const result = await runRepairProposalAgent({ context: failed, bundle: bundleFor(failed), provider });
    expect(result.state).toBe('DETERMINISTIC_ABSTAIN');
    expect(result.modelInvoked).toBe(false);
    expect(provider.calls).toBe(0);
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
