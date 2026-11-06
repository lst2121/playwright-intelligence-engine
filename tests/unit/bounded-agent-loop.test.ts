import { describe, expect, it } from 'vitest';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';
import { buildEvidenceBundle } from '../../src/intelligence/evidence-bundle.js';
import { parseAgentResponse, ProposalParseResult } from '../../src/intelligence/llm-proposal.js';
import { AgentStepProvider, ProposalProvider } from '../../src/intelligence/model-provider.js';
import { runRepairProposalAgent } from '../../src/intelligence/repair-agent.js';

function context(): DiagnosticContext {
  return {
    playwrightVersion: '1.64.1',
    traceFormatVersion: 10,
    failedAction: { callId: 'action@1', action: 'page.click', selector: 'button.checkout', errorMessage: 'Timeout waiting for locator("button.checkout")' },
    snapshots: { action: '<button role="button" aria-label="Checkout">Checkout</button>' },
    networkEvents: [],
    consoleEvents: [],
    evidenceCompleteness: { domAvailable: true, networkAvailable: true, sourceAvailable: true },
  };
}

function bundle() {
  const diagnostic = context();
  return buildEvidenceBundle({
    executionId: 'execution-1',
    testIdentity: 'checkout.spec.ts',
    context: diagnostic,
    failureCategory: 'LOCATOR_DRIFT',
    redactionComplete: true,
    artifacts: [{ kind: 'trace', reference: 'trace.zip', redacted: true }],
  });
}

class LoopProvider implements ProposalProvider, AgentStepProvider {
  public calls = 0;

  public async propose(): Promise<ProposalParseResult> {
    return { isValid: false, errors: ['single-shot path must not be used'] };
  }

  public async proposeStep(input: Parameters<AgentStepProvider['proposeStep']>[0]) {
    this.calls += 1;
    if (input.stepIndex === 0) {
      return parseAgentResponse(JSON.stringify({
        protocolVersion: '2',
        responseType: 'STEP',
        status: 'CONTINUE',
        decision: 'DISCOVER_SOURCE_MAPPING',
        confidence: 0.81,
        reasoningSummary: 'Source ownership must be confirmed before proposing a patch.',
        evidenceReferences: ['trace.failedAction'],
        action: { kind: 'discover_source_mapping', selector: 'button.checkout' },
        requiredObservation: 'A unique Page Object mapping',
      }));
    }
    return parseAgentResponse(JSON.stringify({
      protocolVersion: '2',
      responseType: 'FINAL',
      status: 'PROPOSAL_READY',
      classification: { category: 'LOCATOR_DRIFT', confidence: 0.9 },
      reasoningSummary: 'The unique Page Object locator can be replaced safely.',
      evidenceReferences: ['trace.failedAction', 'source.mapping'],
      proposal: {
        proposalVersion: '1',
        decision: 'PROPOSE',
        failureKind: 'LOCATOR_DRIFT',
        confidence: 0.9,
        reasoningSummary: 'The replacement preserves the target identity.',
        operations: [{ kind: 'replace_locator', target: 'button.checkout', locator: "getByRole('button', { name: 'Checkout' })" }],
        requiredVerification: ['isolated target test'],
        evidenceReferences: ['source.mapping'],
      },
      verification: { isolatedTestPassed: false, assertionsChanged: false, unrelatedFilesChanged: false },
      humanApprovalRequired: true,
    }));
  }
}

describe('bounded reasoning-and-action LLM loop', () => {
  it('parses fenced JSON without accepting extra proposal formats', () => {
    const result = parseAgentResponse(`Model explanation:\n\n\`\`\`json\n${JSON.stringify({
      protocolVersion: '2',
      responseType: 'FINAL',
      status: 'ABSTAIN',
      classification: { category: 'LOCATOR_DRIFT', confidence: 0.7 },
      reasoningSummary: 'Evidence is incomplete.',
      evidenceReferences: ['trace.failedAction'],
      humanApprovalRequired: false,
    })}\n\`\`\``);
    expect(result.isValid).toBe(true);
    expect(result.response?.responseType).toBe('FINAL');
  });

  it('executes one allowlisted observation action before accepting a final proposal', async () => {
    const provider = new LoopProvider();
    const observations: unknown[] = [];
    const result = await runRepairProposalAgent({
      context: context(),
      bundle: bundle(),
      provider,
      maxSteps: 4,
      actionHandlers: {
        discover_source_mapping: async () => {
          const observation = { status: 'FOUND', className: 'CheckoutPage', memberName: 'submit' };
          observations.push(observation);
          return observation;
        },
      },
    });

    expect(result.state).toBe('PROPOSAL_RECEIVED');
    expect(result.modelInvoked).toBe(true);
    expect(provider.calls).toBe(2);
    expect(result.steps).toHaveLength(2);
    expect(result.steps?.[0]?.observation).toEqual({ status: 'FOUND', className: 'CheckoutPage', memberName: 'submit' });
    expect(observations).toEqual([{ status: 'FOUND', className: 'CheckoutPage', memberName: 'submit' }]);
    expect(result.proposal?.operations[0]?.kind).toBe('replace_locator');
  });
});
