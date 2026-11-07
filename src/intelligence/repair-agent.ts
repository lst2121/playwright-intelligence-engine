import { FailureClassifier, ClassificationResult } from '../diagnostics/failure-classifier.js';
import { normalizeFailureCategory } from '../diagnostics/failure-category.js';
import { DiagnosticContext } from '../core/types/diagnostic-context.js';
import { AgentAction, AgentFinalResponse, AgentResponse, EvidenceBundle, LlmRepairProposal, parseLlmRepairProposal, ProposalParseResult } from './llm-proposal.js';
import { AgentStepProvider, AgentStepRequest, ProposalProvider } from './model-provider.js';

export type RepairAgentState =
  | 'DETERMINISTIC_ABSTAIN'
  | 'MODEL_NOT_CONFIGURED'
  | 'EVIDENCE_NOT_REDACTED'
  | 'PROPOSAL_RECEIVED'
  | 'PROPOSAL_REJECTED'
  | 'MODEL_ABSTAINED'
  | 'AGENT_NO_PROGRESS'
  | 'AGENT_TIME_BUDGET'
  | 'AGENT_MAX_STEPS';

export interface RepairAgentStepRecord {
  stepIndex: number;
  response: AgentResponse;
  observation?: unknown;
  durationMs: number;
}

export type RepairAgentActionHandler = (action: AgentAction) => Promise<unknown>;

export interface RepairAgentInput {
  context: DiagnosticContext;
  bundle: EvidenceBundle;
  provider?: ProposalProvider | undefined;
  strategy?: 'auto' | 'single-shot' | 'agent' | undefined;
  maxSteps?: number | undefined;
  maxDurationMs?: number | undefined;
  actionHandlers?: Partial<Record<AgentAction['kind'], RepairAgentActionHandler>> | undefined;
  /**
   * Allows the model to refine only locator-related incomplete evidence. The
   * default remains fail-closed so callers cannot accidentally route backend,
   * auth, assertion, or environment failures to a repair model.
   */
  allowModelEscalation?: boolean | undefined;
}

export interface RepairAgentResult {
  state: RepairAgentState;
  classification: ClassificationResult;
  modelInvoked: boolean;
  proposal?: LlmRepairProposal | undefined;
  errors: string[];
  steps?: RepairAgentStepRecord[] | undefined;
  finalResponse?: AgentFinalResponse | undefined;
}

function proposalMatchesClassification(proposal: LlmRepairProposal, classification: ClassificationResult, failedSelector?: string): string | undefined {
  if (proposal.decision === 'ABSTAIN') return undefined;
  const proposalKind = normalizeFailureCategory(proposal.failureKind);
  const classifiedKind = normalizeFailureCategory(classification.category);
  if (proposalKind !== classifiedKind && proposalKind !== 'LOCATOR_DRIFT') {
    return `Model failureKind '${proposal.failureKind}' conflicts with deterministic classification '${classification.category}'`;
  }
  if (proposal.operations.length === 0) return 'PROPOSE decision requires at least one validated operation';
  if (proposal.operations.some((operation) => operation.kind === 'abstain')) return 'PROPOSE decision cannot contain an abstain operation';
  if (failedSelector) {
    const mismatchedTarget = proposal.operations.find((operation) =>
      operation.kind === 'replace_locator' && operation.target !== failedSelector,
    );
    if (mismatchedTarget) return `Model operation target '${mismatchedTarget.target ?? ''}' does not match deterministic failed selector '${failedSelector}'`;
  }
  return undefined;
}

/**
 * Executes one bounded model proposal step. This is intentionally not a free
 * running agent: deterministic negative controls stop before the provider,
 * the provider receives only an attested bundle, and the result remains a
 * proposal until worktree execution, oracle verification, and approval occur.
 */
export async function runRepairProposalAgent(input: RepairAgentInput): Promise<RepairAgentResult> {
  const classification = FailureClassifier.classify(input.context);
  if (classification.shouldAbstain && !canEscalateLocatorEvidence(input)) {
    return { state: 'DETERMINISTIC_ABSTAIN', classification, modelInvoked: false, errors: [classification.abstentionReason ?? classification.reason] };
  }
  if (!input.bundle.redactionComplete) {
    return { state: 'EVIDENCE_NOT_REDACTED', classification, modelInvoked: false, errors: ['Evidence bundle is not marked redaction-complete'] };
  }
  if (!input.provider) {
    return { state: 'MODEL_NOT_CONFIGURED', classification, modelInvoked: false, errors: ['No proposal provider is configured'] };
  }

  if (input.strategy !== 'single-shot' && isAgentStepProvider(input.provider)) {
    return runBoundedAgentLoop(input, classification, input.provider);
  }

  const result: ProposalParseResult = await input.provider.propose(input.bundle);
  if (!result.isValid || !result.proposal) {
    return { state: 'PROPOSAL_REJECTED', classification, modelInvoked: true, errors: result.errors.length > 0 ? result.errors : ['Provider returned no valid proposal'] };
  }
  const semanticError = proposalMatchesClassification(result.proposal, classification, input.context.failedAction.selector);
  if (semanticError) return { state: 'PROPOSAL_REJECTED', classification, modelInvoked: true, errors: [semanticError] };
  return { state: 'PROPOSAL_RECEIVED', classification, modelInvoked: true, proposal: result.proposal, errors: [] };
}

function canEscalateLocatorEvidence(input: RepairAgentInput): boolean {
  if (input.allowModelEscalation !== true) return false;
  const classification = FailureClassifier.classify(input.context);
  if (!['AMBIGUOUS_MATCH', 'INCOMPLETE_EVIDENCE'].includes(classification.category)) return false;
  if (!input.context.evidenceCompleteness.domAvailable) return false;
  return Boolean(input.context.failedAction.selector?.trim());
}

function isAgentStepProvider(provider: ProposalProvider): provider is ProposalProvider & AgentStepProvider {
  return typeof (provider as Partial<AgentStepProvider>).proposeStep === 'function';
}

async function runBoundedAgentLoop(
  input: RepairAgentInput,
  classification: ClassificationResult,
  provider: ProposalProvider & AgentStepProvider,
): Promise<RepairAgentResult> {
  const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 4, 6));
  const startedAt = Date.now();
  const steps: RepairAgentStepRecord[] = [];
  let previousActionSignature: string | undefined;
  let previousObservationSignature: string | undefined;
  let previousResultSignature: string | undefined;
  const seenTransitions = new Set<string>();
  let observation: unknown = {
    phase: 'deterministic_diagnosis',
    category: classification.category,
    confidence: classification.confidence,
    shouldAbstain: classification.shouldAbstain,
    evidenceCompleteness: input.bundle.diagnostic?.evidenceCompleteness,
  };

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    if (input.maxDurationMs !== undefined && Date.now() - startedAt >= input.maxDurationMs) {
      return {
        state: 'AGENT_TIME_BUDGET',
        classification,
        modelInvoked: true,
        errors: [`Agent reached the elapsed-time budget of ${input.maxDurationMs}ms`],
        steps,
      };
    }
    const started = Date.now();
    const request: AgentStepRequest = {
      bundle: input.bundle,
      deterministicCategory: classification.category,
      deterministicConfidence: classification.confidence,
      observation,
      stepIndex,
      maxSteps,
    };
    const result = await provider.proposeStep(request);
    const durationMs = Date.now() - started;
    if (!result.isValid || !result.response) {
      return {
        state: 'PROPOSAL_REJECTED',
        classification,
        modelInvoked: true,
        errors: result.errors.length > 0 ? result.errors : ['Provider returned no valid agent response'],
        steps,
      };
    }

    const response = result.response;
    if (response.responseType === 'FINAL') {
      steps.push({ stepIndex, response, durationMs });
      if (response.status === 'ABSTAIN' || response.status === 'BLOCKED' || response.status === 'REJECTED' || !response.proposal) {
        return {
          state: 'MODEL_ABSTAINED',
          classification,
          modelInvoked: true,
          errors: [response.reasoningSummary],
          steps,
          finalResponse: response,
        };
      }
      const proposalResult = parseLlmRepairProposal(response.proposal);
      if (!proposalResult.isValid || !proposalResult.proposal) {
        return {
          state: 'PROPOSAL_REJECTED',
          classification,
          modelInvoked: true,
          errors: proposalResult.errors,
          steps,
          finalResponse: response,
        };
      }
      if (proposalResult.proposal.decision === 'ABSTAIN') {
        return {
          state: 'MODEL_ABSTAINED',
          classification,
          modelInvoked: true,
          errors: [proposalResult.proposal.reasoningSummary],
          steps,
          finalResponse: response,
        };
      }
      const semanticError = proposalMatchesClassification(proposalResult.proposal, classification, input.context.failedAction.selector);
      if (semanticError) {
        return { state: 'PROPOSAL_REJECTED', classification, modelInvoked: true, errors: [semanticError], steps, finalResponse: response };
      }
      return {
        state: 'PROPOSAL_RECEIVED',
        classification,
        modelInvoked: true,
        proposal: proposalResult.proposal,
        errors: [],
        steps,
        finalResponse: response,
      };
    }

    const stepRecord: RepairAgentStepRecord = { stepIndex, response, durationMs };
    steps.push(stepRecord);
    if (response.action.kind === 'abstain' || response.decision === 'ABSTAIN') {
      return {
        state: 'MODEL_ABSTAINED',
        classification,
        modelInvoked: true,
        errors: [response.action.reason ?? response.reasoningSummary],
        steps,
      };
    }
    const handler = input.actionHandlers?.[response.action.kind];
    if (!handler) {
      return {
        state: 'PROPOSAL_REJECTED',
        classification,
        modelInvoked: true,
        errors: [`No PIE action handler is configured for '${response.action.kind}'`],
        steps,
      };
    }
    const actionSignature = serializeProgressValue(response.action);
    const observationSignature = serializeProgressValue(observation);
    if (previousActionSignature === actionSignature && previousObservationSignature === observationSignature) {
      return {
        state: 'AGENT_NO_PROGRESS',
        classification,
        modelInvoked: true,
        errors: [`Agent repeated action '${response.action.kind}' without a new observation`],
        steps,
      };
    }
    try {
      const nextObservation = await handler(response.action);
      const nextObservationSignature = serializeProgressValue(nextObservation);
      const transitionSignature = `${actionSignature}\n${nextObservationSignature}`;
      if (seenTransitions.has(transitionSignature)
        || (previousActionSignature === actionSignature && previousResultSignature === nextObservationSignature)) {
        return {
          state: 'AGENT_NO_PROGRESS',
          classification,
          modelInvoked: true,
          errors: [`Agent repeated action '${response.action.kind}' with no new observation`],
          steps,
        };
      }
      seenTransitions.add(transitionSignature);
      observation = nextObservation;
      stepRecord.observation = nextObservation;
      previousActionSignature = actionSignature;
      previousObservationSignature = observationSignature;
      previousResultSignature = nextObservationSignature;
    } catch (error) {
      return {
        state: 'PROPOSAL_REJECTED',
        classification,
        modelInvoked: true,
        errors: [`PIE action '${response.action.kind}' failed: ${error instanceof Error ? error.message : String(error)}`],
        steps,
      };
    }
  }

  return {
    state: 'AGENT_MAX_STEPS',
    classification,
    modelInvoked: true,
    errors: [`Agent reached the maximum step budget of ${maxSteps}`],
    steps,
  };
}

function serializeProgressValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Re-validates a serialized provider response at the orchestration boundary. */
export function validateAgentProposal(input: unknown): ProposalParseResult {
  return parseLlmRepairProposal(input);
}
