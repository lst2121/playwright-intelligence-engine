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

  it('normalizes a recognized sparse step while discarding unsupported patch metadata', () => {
    const result = parseAgentResponse(JSON.stringify({
      protocolVersion: '2',
      responseType: 'STEP',
      status: 'CONTINUE',
      action: {
        kind: 'build_repair_proposal',
        proposal: {
          filePath: 'pages/CheckoutPage.ts',
          line: 12,
          oldLocator: 'button.checkout',
          newLocator: "getByRole('button', { name: 'Checkout' })",
        },
      },
    }));
    expect(result.isValid).toBe(true);
    expect(result.response?.responseType).toBe('STEP');
    if (result.response?.responseType === 'STEP') {
      expect(result.response.action).toEqual({
        kind: 'build_repair_proposal',
        target: 'button.checkout',
        locator: "getByRole('button', { name: 'Checkout' })",
      });
    }
    expect(result.normalizationNotes).toContain('Dropped unsupported nested proposal metadata; retained only allowlisted locator fields.');

    const editStep = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'STEP', status: 'CONTINUE',
      action: { kind: 'build_repair_proposal', proposal: { edits: [{ oldText: 'old locator', newText: 'new locator' }] } },
    }));
    expect(editStep.isValid).toBe(true);
    if (editStep.response?.responseType === 'STEP') {
      expect(editStep.response.action.target).toBe('old locator');
      expect(editStep.response.action.locator).toBe('new locator');
    }

    const wrongTypedTarget = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'STEP', status: 'CONTINUE',
      action: { kind: 'inspect_evidence', target: { filePath: 'pages/Checkout.ts', line: 12 } },
    }));
    expect(wrongTypedTarget.isValid).toBe(true);
    if (wrongTypedTarget.response?.responseType === 'STEP') expect(wrongTypedTarget.response.action.target).toBeUndefined();

    const stringAction = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'STEP', status: 'CONTINUE', action: 'inspect_evidence',
    }));
    expect(stringAction.isValid).toBe(true);
    if (stringAction.response?.responseType === 'STEP') expect(stringAction.response.action.kind).toBe('inspect_evidence');
    expect(stringAction.normalizationNotes).toContain('Normalized a recognized string action into the PIE action object schema.');
  });

  it('fails closed on recognized sparse final variants', () => {
    const legacyProposal = parseAgentResponse(JSON.stringify({
      protocolVersion: '2',
      responseType: 'FINAL',
      status: 'PROPOSAL',
      proposal: {
        target: { filePath: 'pages/AdminPage.ts', line: 31, column: 30 },
        locator: "page.getByRole('button', { name: 'Login' })",
      },
    }));
    expect(legacyProposal.isValid).toBe(true);
    expect(legacyProposal.response?.responseType).toBe('FINAL');
    if (legacyProposal.response?.responseType === 'FINAL') {
      expect(legacyProposal.response.status).toBe('BLOCKED');
      expect(legacyProposal.response.proposal).toBeUndefined();
    }
    expect(legacyProposal.normalizationNotes?.[0]).toContain('Mapped recognized legacy FINAL PROPOSAL shape to BLOCKED');

    const sparseAbstain = parseAgentResponse(JSON.stringify({ protocolVersion: '2', responseType: 'FINAL', status: 'ABSTAIN' }));
    expect(sparseAbstain.isValid).toBe(true);
    expect(sparseAbstain.response?.responseType).toBe('FINAL');
    if (sparseAbstain.response?.responseType === 'FINAL') {
      expect(sparseAbstain.response.status).toBe('ABSTAIN');
      expect(sparseAbstain.response.humanApprovalRequired).toBe(true);
    }

    const legacyRepair = parseAgentResponse(JSON.stringify({
      protocolVersion: '2',
      responseType: 'FINAL',
      status: 'PROPOSED',
      proposal: {
        failureCategory: 'LOCATOR_DRIFT',
        confidence: 0.93,
        summary: 'The accessible name changed.',
        edits: [{ oldText: "getByRole('button', { name: 'Sign in' })", newText: "getByRole('button', { name: 'Login' })" }],
      },
    }));
    expect(legacyRepair.isValid).toBe(true);
    if (legacyRepair.response?.responseType === 'FINAL') {
      expect(legacyRepair.response.status).toBe('PROPOSAL_READY');
      expect(legacyRepair.response.proposal?.operations).toEqual([{
        kind: 'replace_locator',
        target: "getByRole('button', { name: 'Sign in' })",
        locator: "getByRole('button', { name: 'Login' })",
      }]);
    }

    const proposalOnly = parseAgentResponse(JSON.stringify({
      protocolVersion: '2',
      responseType: 'FINAL',
      status: 'PROPOSAL_ONLY',
      proposal: {
        failureCategory: 'LOCATOR_DRIFT',
        originalLocator: "getByRole('button', { name: 'Sign in' })",
        proposedLocator: "getByRole('button', { name: 'Login' })",
        confidence: 0.97,
        rationale: 'The accessible name changed.',
      },
    }));
    expect(proposalOnly.isValid).toBe(true);
    if (proposalOnly.response?.responseType === 'FINAL') {
      expect(proposalOnly.response.status).toBe('PROPOSAL_READY');
      expect(proposalOnly.response.proposal?.operations[0]?.kind).toBe('replace_locator');
    }

    const inferredCategory = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'FINAL', status: 'PROPOSED',
      proposal: { target: 'old locator', locator: 'new locator', confidence: 0.9 },
    }));
    expect(inferredCategory.isValid).toBe(true);
    if (inferredCategory.response?.responseType === 'FINAL') {
      expect(inferredCategory.response.status).toBe('PROPOSAL_READY');
      expect(inferredCategory.response.proposal?.failureKind).toBe('LOCATOR_DRIFT');
    }

    const categoryAlias = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'FINAL', status: 'PROPOSED',
      proposal: {
        category: 'LOCATOR_DRIFT',
        originalLocator: 'old locator',
        proposedLocator: 'new locator',
        confidence: 0.9,
      },
    }));
    expect(categoryAlias.isValid).toBe(true);
    if (categoryAlias.response?.responseType === 'FINAL') expect(categoryAlias.response.status).toBe('PROPOSAL_READY');

    const ambiguousRepair = parseAgentResponse(JSON.stringify({
      protocolVersion: '2',
      responseType: 'FINAL',
      status: 'COMPLETE',
      proposal: { failureCategory: 'AMBIGUOUS_MATCH', target: 'Login', locator: "getByRole('button', { name: 'Login' })" },
    }));
    expect(ambiguousRepair.isValid).toBe(true);
    if (ambiguousRepair.response?.responseType === 'FINAL') {
      expect(ambiguousRepair.response.status).toBe('BLOCKED');
      expect(ambiguousRepair.response.proposal).toBeUndefined();
    }

    const sparseOk = parseAgentResponse(JSON.stringify({
      protocolVersion: '2', responseType: 'FINAL', status: 'OK',
      proposal: { proposalVersion: '1', locator: "getByRole('button', { name: 'Login' })" },
    }));
    expect(sparseOk.isValid).toBe(true);
    if (sparseOk.response?.responseType === 'FINAL') expect(sparseOk.response.status).toBe('BLOCKED');
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

  it('stops when the model repeats an action without new evidence', async () => {
    const provider: ProposalProvider & AgentStepProvider = {
      propose: async () => ({ isValid: false, errors: ['not used'] }),
      proposeStep: async () => parseAgentResponse(JSON.stringify({
        protocolVersion: '2',
        responseType: 'STEP',
        status: 'CONTINUE',
        decision: 'INSPECT_EVIDENCE',
        confidence: 0.5,
        reasoningSummary: 'Inspect the same evidence.',
        evidenceReferences: [],
        action: { kind: 'inspect_evidence' },
        requiredObservation: 'Return inspection evidence.',
      })),
    };
    const result = await runRepairProposalAgent({
      context: context(),
      bundle: bundle(),
      provider,
      maxSteps: 6,
      actionHandlers: { inspect_evidence: async () => ({ status: 'UNCHANGED' }) },
    });
    expect(result.state).toBe('AGENT_NO_PROGRESS');
    expect(result.steps).toHaveLength(2);
  });

  it('stops before a model call when the elapsed-time budget is exhausted', async () => {
    const provider: ProposalProvider & AgentStepProvider = {
      propose: async () => ({ isValid: false, errors: ['not used'] }),
      proposeStep: async () => parseAgentResponse(JSON.stringify({
        protocolVersion: '2', responseType: 'FINAL', status: 'ABSTAIN',
        classification: { category: 'LOCATOR_DRIFT', confidence: 0 },
        reasoningSummary: 'unused', evidenceReferences: [], humanApprovalRequired: true,
      })),
    };
    const result = await runRepairProposalAgent({ context: context(), bundle: bundle(), provider, maxDurationMs: 0 });
    expect(result.state).toBe('AGENT_TIME_BUDGET');
    expect(result.steps).toHaveLength(0);
  });
});
