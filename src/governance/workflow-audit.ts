import { AuditLog } from './audit-log.js';
import type { ArchitecturePlan, ArchitectureWriteResult } from '../generator/architecture-generator.js';
import type { CiEvidenceReport } from '../integrations/playwright-report-adapter.js';

export interface RepairWorkflowAuditInput {
  status: 'ABSTAINED' | 'INPUT_REQUIRED' | 'OPERATION_PROPOSAL_ONLY' | 'PROPOSAL_READY' | 'VERIFIED_READY_FOR_APPROVAL' | 'REJECTED';
  category: string;
  proposalId?: string | undefined;
  worktreeId?: string | undefined;
  executionPassed?: boolean | undefined;
}

export async function recordArchitectureWorkflow(
  root: string,
  plan: ArchitecturePlan,
  writeResult?: ArchitectureWriteResult,
): Promise<void> {
  await new AuditLog(root).append({
    actor: 'system',
    action: 'architecture_plan',
    outcome: plan.status === 'ABSTAIN' ? 'abstained' : 'allowed',
    target: plan.featureName,
    metadata: {
      mode: plan.mode,
      status: plan.status,
      plannedFiles: plan.files.length,
      createdFiles: writeResult?.written.length ?? 0,
      skippedFiles: writeResult?.skipped.length ?? 0,
      warnings: plan.warnings.length,
    },
  });
}

export async function recordCiWorkflow(root: string, report: CiEvidenceReport): Promise<void> {
  await new AuditLog(root).append({
    actor: 'system',
    action: 'ci_evidence_ingested',
    outcome: report.qualityGate.status === 'PASS' ? 'allowed' : report.qualityGate.status === 'ABSTAIN' ? 'abstained' : 'failed',
    target: report.clusters[0]?.representative.repository ?? 'playwright-report',
    metadata: {
      status: report.qualityGate.status,
      tests: report.runs.length,
      failures: report.failures.length,
      clusters: report.clusters.length,
      flakyTests: report.stability.filter((test) => test.flaky).length,
      criticalClusters: report.qualityGate.criticalClusters,
    },
  });
}

export async function recordRepairWorkflow(root: string, input: RepairWorkflowAuditInput): Promise<void> {
  const outcome = input.status === 'ABSTAINED'
    ? 'abstained'
    : input.status === 'REJECTED'
      ? 'failed'
    : input.status === 'INPUT_REQUIRED'
        ? 'denied'
        : 'allowed';
  await new AuditLog(root).append({
    actor: 'system',
    action: 'repair_workflow',
    outcome,
    target: input.category,
    metadata: {
      status: input.status,
      category: input.category,
      ...(input.proposalId ? { proposalId: input.proposalId } : {}),
      ...(input.worktreeId ? { worktreeId: input.worktreeId } : {}),
      ...(input.executionPassed !== undefined ? { executionPassed: input.executionPassed } : {}),
    },
  });
}
