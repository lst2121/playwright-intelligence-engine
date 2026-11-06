import { LlmRepairProposal, parseLlmRepairProposal } from './llm-proposal.js';
import { RepairWorkflowInput, RepairWorkflowResult, runRepairWorkflow } from '../repair/repair-workflow.js';
import { WorkflowPlan, compileWorkflowPlan } from '../repair/workflow-plan.js';

export interface VerifiedLlmRepairInput extends Omit<RepairWorkflowInput, 'operation'> {
  proposal: LlmRepairProposal | unknown;
}

export interface LlmRepairPlanValidation {
  isValid: boolean;
  proposal?: LlmRepairProposal | undefined;
  workflowPlan?: WorkflowPlan | undefined;
  errors: string[];
}

/** Validates a possibly multi-operation LLM plan without touching source files. */
export function validateLlmRepairPlan(input: unknown): LlmRepairPlanValidation {
  const parsed = parseLlmRepairProposal(input);
  if (!parsed.isValid || !parsed.proposal) return { isValid: false, errors: parsed.errors };
  const workflowPlan = compileWorkflowPlan(parsed.proposal.operations);
  if (workflowPlan.status !== 'EXECUTABLE') return { isValid: false, proposal: parsed.proposal, workflowPlan, errors: workflowPlan.errors };
  return { isValid: true, proposal: parsed.proposal, workflowPlan, errors: [] };
}

/**
 * Bridges a validated LLM proposal into PIE's existing deterministic repair
 * workflow. The bridge is intentionally limited to one exact-target operation
 * until multi-operation convergence has its own combined verification proof.
 */
export async function runVerifiedLlmRepairWorkflow(input: VerifiedLlmRepairInput): Promise<RepairWorkflowResult> {
  const parsed = parseLlmRepairProposal(input.proposal);
  if (!parsed.isValid || !parsed.proposal) {
    throw new Error(`LLM repair proposal rejected: ${parsed.errors.join('; ')}`);
  }
  if (parsed.proposal.decision === 'ABSTAIN') {
    throw new Error('LLM repair proposal requested abstention');
  }
  if (parsed.proposal.operations.length !== 1) {
    throw new Error('LLM repair proposal requires exactly one operation for verified execution');
  }
  const operation = parsed.proposal.operations[0]!;
  if (operation.kind === 'abstain') throw new Error('LLM repair proposal cannot execute an abstain operation');
  return runRepairWorkflow({
    ...input,
    operation,
    requireOperationTargetMatch: true,
  });
}
