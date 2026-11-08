import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator, CorrelatedEvidence } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { bootstrapProjectIntelligence, recordProjectSemanticVerification } from '../intelligence/project-intelligence.js';
import { parseExternalFailureEvidence, supplementDiagnosticContext } from '../diagnostics/external-failure-evidence.js';
import { ApprovalService, StagedProposal } from './approval-service.js';
import { RepairPlanner, RepairProposal, VerifiedRepairResult } from './repair-planner.js';
import { WorktreeManager, WorktreeInfo } from '../sandbox/worktree-manager.js';
import { recordRepairWorkflow } from '../governance/workflow-audit.js';
import { compileSafeRepairOperation } from './safe-operation-compiler.js';
import { discoverRepairSourceMapping } from './source-mapper.js';

export type RepairWorkflowStatus = 'ABSTAINED' | 'INPUT_REQUIRED' | 'OPERATION_PROPOSAL_ONLY' | 'PROPOSAL_READY' | 'VERIFIED_READY_FOR_APPROVAL' | 'REJECTED';

export interface RepairWorkflowInput {
  tracePath: string;
  workspaceRoot?: string | undefined;
  errorContextPath?: string | undefined;
  testFilePath?: string | undefined;
  pomFilePath?: string | undefined;
  className?: string | undefined;
  memberName?: string | undefined;
  configPath?: string | undefined;
  project?: string | undefined;
  execute?: boolean | undefined;
  worktreeId?: string | undefined;
  operation?: unknown;
  requireOperationTargetMatch?: boolean | undefined;
}

export interface RepairWorkflowResult {
  status: RepairWorkflowStatus;
  correlated: CorrelatedEvidence;
  proposedLocator?: string | undefined;
  candidate?: {
    locatorExpression: string;
    score: number;
    element: RepairProposal['candidateElement'];
  } | undefined;
  proposal?: RepairProposal | undefined;
  stagedProposal?: StagedProposal | undefined;
  worktree?: WorktreeInfo | undefined;
  verification?: VerifiedRepairResult | undefined;
  reason?: string | undefined;
}

function assertWorkspacePath(root: string, target: string, label: string): string {
  const canonicalRoot = fsSync.realpathSync(root);
  const resolved = path.resolve(root, target);
  if (!fsSync.existsSync(resolved)) throw new Error(`${label} not found: '${resolved}'`);
  const canonicalTarget = fsSync.realpathSync(resolved);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes workspace root: '${target}'`);
  return canonicalTarget;
}

function resolveReadOnlyPath(root: string, target: string, label: string): string {
  const resolved = path.isAbsolute(target) ? target : path.resolve(root, target);
  if (!fsSync.existsSync(resolved)) throw new Error(`${label} not found: '${resolved}'`);
  return fsSync.realpathSync(resolved);
}

async function loadCorrelatedEvidence(input: RepairWorkflowInput, workspaceRoot: string): Promise<CorrelatedEvidence> {
  const tracePath = resolveReadOnlyPath(workspaceRoot, input.tracePath, 'Trace archive');
  const { traceEntryName, networkEntryName, traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(tracePath);
  if (!traceEntryName) throw new Error(`No .trace event stream found in archive '${tracePath}'`);
  const traceText = await ArchiveReader.readEntriesAsText(tracePath, traceEntryNames ?? [traceEntryName]);
  const networkText = (networkEntryNames ?? (networkEntryName ? [networkEntryName] : [])).length > 0
    ? await ArchiveReader.readEntriesAsText(tracePath, networkEntryNames ?? [networkEntryName!])
    : '';
  let context = TraceParser.assembleDiagnosticContext(traceText.split('\n'), networkText.split('\n'));
  if (input.errorContextPath) {
    const errorContextPath = resolveReadOnlyPath(workspaceRoot, input.errorContextPath, 'Error context');
    context = supplementDiagnosticContext(context, parseExternalFailureEvidence(await fs.readFile(errorContextPath, 'utf8')));
  }
  return EvidenceCorrelator.correlate(context);
}

function stageProposal(proposal: RepairProposal, worktreeId: string): StagedProposal {
  const testFileContent = fsSync.readFileSync(proposal.testFilePath, 'utf8');
  return ApprovalService.getInstance().stageProposal({
    targetFilePath: proposal.pomFilePath,
    targetClassName: proposal.className,
    targetMemberName: proposal.memberName,
    originalSourceContent: proposal.originalSource,
    replacementSelector: proposal.replacementSelector,
    fullDiff: proposal.fullDiff ?? '',
    patchedSource: proposal.proposedPatchedSource,
    testFilePath: proposal.testFilePath,
    testFileContent,
    worktreeId,
  });
}

/**
 * Trace-to-repair bridge. It is proposal-only by default. `execute: true`
 * creates a dedicated worktree and runs the existing verification lifecycle;
 * it never writes the active workspace or issues an approval token.
 */
export async function runRepairWorkflow(input: RepairWorkflowInput): Promise<RepairWorkflowResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  if (!fsSync.existsSync(workspaceRoot)) throw new Error(`Workspace root does not exist: '${workspaceRoot}'`);
  const correlated = await loadCorrelatedEvidence(input, workspaceRoot);
  const intelligence = await bootstrapProjectIntelligence(workspaceRoot);
  const selected = DiagnosticReportGenerator.selectRepairCandidate(correlated, intelligence);

  if (correlated.classification.shouldAbstain) {
    const result = { status: 'ABSTAINED' as const, correlated, reason: correlated.classification.abstentionReason ?? correlated.classification.reason };
    await recordRepairWorkflow(workspaceRoot, { status: result.status, category: correlated.classification.category });
    return result;
  }
  if (!selected) {
    const result = { status: 'ABSTAINED' as const, correlated, reason: 'No unique, semantically compatible repair candidate survived PIE abstention gates.' };
    await recordRepairWorkflow(workspaceRoot, { status: result.status, category: correlated.classification.category });
    return result;
  }

  const candidate = { locatorExpression: selected.locatorExpression, score: selected.breakdown.score, element: selected.element };
  let explicitReplacement: string | undefined;
  if (input.operation !== undefined) {
    if (input.requireOperationTargetMatch === true) {
      const operation = input.operation && typeof input.operation === 'object' ? input.operation as Record<string, unknown> : undefined;
      const failedSelector = correlated.context.failedAction.selector?.trim();
      const operationTarget = typeof operation?.target === 'string' ? operation.target.trim() : undefined;
      if (!failedSelector || !operationTarget || operationTarget !== failedSelector) {
        const result = { status: 'ABSTAINED' as const, correlated, proposedLocator: selected.locatorExpression, candidate, reason: 'The proposed operation target does not exactly match the deterministic failed selector.' };
        await recordRepairWorkflow(workspaceRoot, { status: result.status, category: correlated.classification.category });
        return result;
      }
    }
    const compiled = compileSafeRepairOperation(input.operation);
    if (compiled.readiness === 'ABSTAIN') {
      const result = { status: 'ABSTAINED' as const, correlated, proposedLocator: selected.locatorExpression, candidate, reason: compiled.reason };
      await recordRepairWorkflow(workspaceRoot, { status: result.status, category: correlated.classification.category });
      return result;
    }
    if (compiled.readiness === 'PROPOSAL_ONLY') {
      const result = { status: 'OPERATION_PROPOSAL_ONLY' as const, correlated, proposedLocator: selected.locatorExpression, candidate, reason: compiled.reason };
      await recordRepairWorkflow(workspaceRoot, { status: result.status, category: correlated.classification.category });
      return result;
    }
    explicitReplacement = compiled.replacementLocator;
  }
  const mapping = input.testFilePath && input.pomFilePath && input.className && input.memberName
    ? undefined
    : await discoverRepairSourceMapping({ workspaceRoot, failedAction: correlated.context.failedAction });
  const resolvedTestFilePath = input.testFilePath ?? mapping?.testFilePath;
  const resolvedPomFilePath = input.pomFilePath ?? mapping?.pomFilePath;
  const resolvedClassName = input.className ?? mapping?.className;
  const resolvedMemberName = input.memberName ?? mapping?.memberName;
  const required = [
    ['testFilePath', resolvedTestFilePath],
    ['pomFilePath', resolvedPomFilePath],
    ['className', resolvedClassName],
    ['memberName', resolvedMemberName],
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    const result = { status: 'INPUT_REQUIRED' as const, correlated, proposedLocator: selected.locatorExpression, candidate, reason: `Repair mapping is required: ${missing.join(', ')}` };
    await recordRepairWorkflow(workspaceRoot, { status: result.status, category: correlated.classification.category });
    return result;
  }

  const testFilePath = assertWorkspacePath(workspaceRoot, resolvedTestFilePath!, 'Test file');
  const pomFilePath = assertWorkspacePath(workspaceRoot, resolvedPomFilePath!, 'Page Object file');
  const proposal = RepairPlanner.planRepair({
    originalActionId: correlated.context.failedAction.callId,
    originalSelector: correlated.context.failedAction.selector ?? '',
    candidateElement: selected.element,
    candidateScore: selected.breakdown.score,
    testFilePath,
    pomFilePath,
    className: resolvedClassName!,
    memberName: resolvedMemberName!,
    intendedAction: correlated.context.failedAction.action,
    replacementSelector: explicitReplacement,
    worktreeId: input.worktreeId,
  });

  if (!input.execute) {
    const stagedProposal = stageProposal(proposal, 'proposal-only');
    await recordRepairWorkflow(workspaceRoot, {
      status: 'PROPOSAL_READY',
      category: correlated.classification.category,
      proposalId: stagedProposal.proposalId,
    });
    return { status: 'PROPOSAL_READY', correlated, proposedLocator: selected.locatorExpression, candidate, proposal, stagedProposal };
  }

  const configPath = input.configPath
    ? assertWorkspacePath(workspaceRoot, input.configPath, 'Playwright config')
    : undefined;
  const manager = new WorktreeManager(workspaceRoot);
  const worktree = await manager.createWorktree(input.worktreeId);
  const verification = await RepairPlanner.executeAndVerifyInWorktree({
    proposal,
    worktreePath: worktree.worktreePath,
    worktreeId: worktree.id,
    workspaceRoot,
    configPath,
    project: input.project,
  });
  const stagedProposal = ApprovalService.getInstance().stageProposal({
    targetFilePath: proposal.pomFilePath,
    targetClassName: proposal.className,
    targetMemberName: proposal.memberName,
    originalSourceContent: proposal.originalSource,
    replacementSelector: proposal.replacementSelector,
    fullDiff: proposal.fullDiff ?? '',
    patchedSource: proposal.proposedPatchedSource,
    testFilePath: proposal.testFilePath,
    testFileContent: fsSync.readFileSync(proposal.testFilePath, 'utf8'),
    worktreeId: worktree.id,
    ...(verification.isReadyForApproval ? { proof: verification.executionProof } : {}),
  });
  await recordRepairWorkflow(workspaceRoot, {
    status: verification.isReadyForApproval ? 'VERIFIED_READY_FOR_APPROVAL' : 'REJECTED',
    category: correlated.classification.category,
    proposalId: stagedProposal.proposalId,
    worktreeId: worktree.id,
    executionPassed: verification.executionProof.passed,
  });
  if (verification.isReadyForApproval) {
    await recordProjectSemanticVerification(workspaceRoot, proposal.replacementSelector);
  }
  return {
    status: verification.isReadyForApproval ? 'VERIFIED_READY_FOR_APPROVAL' : 'REJECTED',
    correlated,
    proposedLocator: selected.locatorExpression,
    candidate,
    proposal,
    stagedProposal,
    worktree,
    verification,
    reason: verification.isReadyForApproval ? 'Isolated verification passed; explicit approval is still required.' : 'Isolated verification did not satisfy all repair gates.',
  };
}
