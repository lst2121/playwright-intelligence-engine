import { LlmRepairProposal } from './llm-proposal.js';
import { TraceProposalWorkflowInput, TraceProposalWorkflowResult, runTraceProposalWorkflow } from './trace-proposal-workflow.js';
import { runVerifiedLlmRepairWorkflow } from './verified-llm-repair-workflow.js';
import { RepairWorkflowResult } from '../repair/repair-workflow.js';
import { ApprovalService } from '../repair/approval-service.js';
import { WorkspacePromoter, PromotionResult } from '../repair/workspace-promoter.js';

export interface AutonomousRepairWorkflowInput extends TraceProposalWorkflowInput {
  execute?: boolean | undefined;
  testFilePath?: string | undefined;
  pomFilePath?: string | undefined;
  className?: string | undefined;
  memberName?: string | undefined;
  configPath?: string | undefined;
  worktreeId?: string | undefined;
  autoPromote?: boolean | undefined;
}

export type AutonomousRepairStatus =
  | 'ABSTAINED'
  | 'MODEL_NOT_CONFIGURED'
  | 'PROPOSAL_REJECTED'
  | 'PROPOSAL_READY'
  | 'INPUT_REQUIRED'
  | 'VERIFIED_READY_FOR_APPROVAL'
  | 'PROMOTED'
  | 'VERIFICATION_FAILED';

export interface AutonomousRepairWorkflowResult {
  status: AutonomousRepairStatus;
  proposalRun: TraceProposalWorkflowResult;
  proposal?: LlmRepairProposal | undefined;
  verification?: RepairWorkflowResult | undefined;
  promotion?: PromotionResult | undefined;
  reason?: string | undefined;
}

/**
 * Connects PIE's bounded reasoning loop to its existing deterministic repair
 * verifier. The model can propose one allowlisted operation, but only the
 * deterministic workflow can apply it in a disposable worktree and decide
 * whether it is eligible for approval.
 */
export async function runAutonomousRepairWorkflow(
  input: AutonomousRepairWorkflowInput,
): Promise<AutonomousRepairWorkflowResult> {
  const proposalRun = await runTraceProposalWorkflow(input);
  const agent = proposalRun.agent;

  if (!agent.proposal) {
    const reason = agent.errors.join('; ') || 'The agent did not produce a repair proposal.';
    const status: AutonomousRepairStatus = agent.state === 'MODEL_NOT_CONFIGURED'
      ? 'MODEL_NOT_CONFIGURED'
      : agent.state === 'PROPOSAL_REJECTED'
        ? 'PROPOSAL_REJECTED'
        : 'ABSTAINED';
    return { status, proposalRun, reason };
  }

  if (agent.proposal.decision === 'ABSTAIN') {
    return {
      status: 'ABSTAINED',
      proposalRun,
      proposal: agent.proposal,
      reason: agent.proposal.reasoningSummary,
    };
  }

  if (input.execute !== true && input.autoPromote !== true) {
    return {
      status: 'PROPOSAL_READY',
      proposalRun,
      proposal: agent.proposal,
      reason: 'Proposal validated. Execution was not requested.',
    };
  }

  let verification: RepairWorkflowResult;
  try {
    verification = await runVerifiedLlmRepairWorkflow({
      tracePath: input.tracePath,
      workspaceRoot: input.workspaceRoot,
      errorContextPath: input.errorContextPath,
      testFilePath: input.testFilePath,
      pomFilePath: input.pomFilePath,
      className: input.className,
      memberName: input.memberName,
      configPath: input.configPath,
      worktreeId: input.worktreeId,
      execute: true,
      proposal: agent.proposal,
    });
  } catch (error) {
    return {
      status: 'PROPOSAL_REJECTED',
      proposalRun,
      proposal: agent.proposal,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const status: AutonomousRepairStatus = verification.status === 'VERIFIED_READY_FOR_APPROVAL'
    ? 'VERIFIED_READY_FOR_APPROVAL'
    : verification.status === 'INPUT_REQUIRED'
      ? 'INPUT_REQUIRED'
      : verification.status === 'ABSTAINED'
        ? 'ABSTAINED'
        : 'VERIFICATION_FAILED';

  if (status === 'VERIFIED_READY_FOR_APPROVAL' && input.autoPromote === true) {
    const staged = verification.stagedProposal;
    if (!staged || !verification.proposal) {
      return { status: 'VERIFICATION_FAILED', proposalRun, proposal: agent.proposal, verification, reason: 'Verified repair did not produce a promotable staged proposal.' };
    }
    try {
      const token = ApprovalService.getInstance().authorizeProposal({ proposalId: staged.proposalId });
      const promotion = await WorkspacePromoter.promote({
        targetFilePath: token.targetFilePath,
        workspaceRoot: input.workspaceRoot ?? process.cwd(),
        patchedContent: verification.proposal.proposedPatchedSource,
        approvalTokenPayload: token,
      });
      if (!promotion.success) {
        return { status: 'VERIFICATION_FAILED', proposalRun, proposal: agent.proposal, verification, promotion, reason: promotion.error ?? 'Promotion failed.' };
      }
      return { status: 'PROMOTED', proposalRun, proposal: agent.proposal, verification, promotion, reason: 'Verified repair was promoted under explicit auto-promote policy.' };
    } catch (error) {
      return { status: 'VERIFICATION_FAILED', proposalRun, proposal: agent.proposal, verification, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    status,
    proposalRun,
    proposal: agent.proposal,
    verification,
    reason: verification.reason,
  };
}
