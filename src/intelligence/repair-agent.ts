import { FailureClassifier, ClassificationResult } from '../diagnostics/failure-classifier.js';
import { DiagnosticContext } from '../core/types/diagnostic-context.js';
import { EvidenceBundle, LlmRepairProposal, parseLlmRepairProposal, ProposalParseResult } from './llm-proposal.js';
import { ProposalProvider } from './model-provider.js';

export type RepairAgentState =
  | 'DETERMINISTIC_ABSTAIN'
  | 'MODEL_NOT_CONFIGURED'
  | 'EVIDENCE_NOT_REDACTED'
  | 'PROPOSAL_RECEIVED'
  | 'PROPOSAL_REJECTED';

export interface RepairAgentInput {
  context: DiagnosticContext;
  bundle: EvidenceBundle;
  provider?: ProposalProvider | undefined;
}

export interface RepairAgentResult {
  state: RepairAgentState;
  classification: ClassificationResult;
  modelInvoked: boolean;
  proposal?: LlmRepairProposal | undefined;
  errors: string[];
}

function proposalMatchesClassification(proposal: LlmRepairProposal, classification: ClassificationResult): string | undefined {
  if (proposal.decision === 'ABSTAIN') return undefined;
  const proposalKind = proposal.failureKind.trim().toUpperCase();
  const classifiedKind = classification.category.trim().toUpperCase();
  if (proposalKind !== classifiedKind && proposalKind !== 'LOCATOR_DRIFT') {
    return `Model failureKind '${proposal.failureKind}' conflicts with deterministic classification '${classification.category}'`;
  }
  if (proposal.operations.length === 0) return 'PROPOSE decision requires at least one validated operation';
  if (proposal.operations.some((operation) => operation.kind === 'abstain')) return 'PROPOSE decision cannot contain an abstain operation';
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
  if (classification.shouldAbstain) {
    return { state: 'DETERMINISTIC_ABSTAIN', classification, modelInvoked: false, errors: [classification.abstentionReason ?? classification.reason] };
  }
  if (!input.bundle.redactionComplete) {
    return { state: 'EVIDENCE_NOT_REDACTED', classification, modelInvoked: false, errors: ['Evidence bundle is not marked redaction-complete'] };
  }
  if (!input.provider) {
    return { state: 'MODEL_NOT_CONFIGURED', classification, modelInvoked: false, errors: ['No proposal provider is configured'] };
  }

  const result: ProposalParseResult = await input.provider.propose(input.bundle);
  if (!result.isValid || !result.proposal) {
    return { state: 'PROPOSAL_REJECTED', classification, modelInvoked: true, errors: result.errors.length > 0 ? result.errors : ['Provider returned no valid proposal'] };
  }
  const semanticError = proposalMatchesClassification(result.proposal, classification);
  if (semanticError) return { state: 'PROPOSAL_REJECTED', classification, modelInvoked: true, errors: [semanticError] };
  return { state: 'PROPOSAL_RECEIVED', classification, modelInvoked: true, proposal: result.proposal, errors: [] };
}

/** Re-validates a serialized provider response at the orchestration boundary. */
export function validateAgentProposal(input: unknown): ProposalParseResult {
  return parseLlmRepairProposal(input);
}
