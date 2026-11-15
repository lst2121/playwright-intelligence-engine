import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ArchiveReader } from '../trace/archive-reader.js';
import { runTraceProposalWorkflow } from './trace-proposal-workflow.js';
import { discoverRepairSourceMapping } from '../repair/source-mapper.js';
import { AstPatcher } from '../repair/ast-patcher.js';
import { StatementPatcher } from '../repair/statement-patcher.js';
import { WorktreeManager, WorktreeInfo } from '../sandbox/worktree-manager.js';
import { ExecutionRunner } from '../sandbox/execution-runner.js';
import { DiffAllowlistValidator } from '../repair/diff-allowlist.js';
import { clusterFailures, FailureObservation, FailureCluster } from './failure-clustering.js';
import { LlmRepairProposal } from './llm-proposal.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { bootstrapProjectIntelligence } from './project-intelligence.js';

export interface BatchRepairWorkflowInput {
  workspaceRoot?: string | undefined;
  tracePaths?: string[] | undefined;
  execute?: boolean | undefined;
  autoPromote?: boolean | undefined;
  configPath?: string | undefined;
  worktreeId?: string | undefined;
  enableBrowserInvestigation?: boolean | undefined;
  browserUrl?: string | undefined;
  browserAllowedHosts?: string[] | undefined;
  enableTestExecution?: boolean | undefined;
}

export type BatchItemStatus =
  | 'PENDING'
  | 'PROPOSAL_READY'
  | 'ABSTAINED'
  | 'VERIFIED'
  | 'PROMOTED'
  | 'VERIFICATION_FAILED'
  | 'REJECTED'
  | 'FAILED';

export interface BatchRepairItem {
  tracePath: string;
  testTitle?: string | undefined;
  status: BatchItemStatus;
  category: string;
  confidence: number;
  reason?: string | undefined;
  failedTarget?: string | undefined;
  healedLocator?: string | undefined;
  targetFilePath?: string | undefined;
  testFilePath?: string | undefined;
  className?: string | undefined;
  memberName?: string | undefined;
  pattern?: 'page-object' | 'inline-locator' | 'statement-patch' | undefined;
  proposal?: LlmRepairProposal | undefined;
  fullDiff?: string | undefined;
}

export interface BatchRepairWorkflowResult {
  status: 'COMPLETED' | 'PARTIAL' | 'ABSTAINED' | 'FAILED';
  totalTraces: number;
  repairedCount: number;
  abstainedCount: number;
  failedCount: number;
  items: BatchRepairItem[];
  clusters: FailureCluster[];
  worktree?: WorktreeInfo | undefined;
  executionPassed?: boolean | undefined;
  promotedFiles?: string[] | undefined;
  reportJsonPath?: string | undefined;
}

function discoverFailingTraces(workspaceRoot: string): string[] {
  const candidateDirs = [
    path.resolve(workspaceRoot, 'test-results'),
    path.resolve(workspaceRoot, 'playwright-report'),
    path.resolve(workspaceRoot),
  ];

  const found: { filePath: string; mtime: number; hasFailure: boolean; isTestResults: boolean }[] = [];
  const seen = new Set<string>();

  for (const dir of candidateDirs) {
    if (!fsSync.existsSync(dir)) continue;
    try {
      const entries = fsSync.readdirSync(dir, { recursive: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, String(entry));
        if (fullPath.endsWith('.zip') && !seen.has(fullPath)) {
          try {
            const stat = fsSync.statSync(fullPath);
            if (stat.isFile()) {
              seen.add(fullPath);
              let hasFailure = false;
              try {
                const discovery = ArchiveReader.findTraceFileEntries(fullPath);
                hasFailure = Boolean(discovery.hasFailure);
              } catch {}
              const isTestResults = fullPath.includes('test-results');
              found.push({ filePath: fullPath, mtime: stat.mtimeMs, hasFailure, isTestResults });
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Filter for traces with confirmed failures, prioritizing test-results over duplicate report copies
  const testResultsFailing = found.filter((f) => f.isTestResults && f.hasFailure);
  const failing = testResultsFailing.length > 0 ? testResultsFailing : found.filter((f) => f.hasFailure);
  const pool = failing.length > 0 ? failing : found;
  return pool
    .sort((a, b) => {
      if (a.hasFailure !== b.hasFailure) return a.hasFailure ? -1 : 1;
      if (a.isTestResults !== b.isTestResults) return a.isTestResults ? -1 : 1;
      return b.mtime - a.mtime;
    })
    .map((f) => f.filePath);
}

/**
 * Executes multi-trace failure diagnosis, clustering, isolated single-worktree
 * batch verification, and atomic promotion for the entire repository.
 */
export async function runBatchRepairWorkflow(
  input: BatchRepairWorkflowInput,
): Promise<BatchRepairWorkflowResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const tracePaths = input.tracePaths && input.tracePaths.length > 0
    ? input.tracePaths.map((p) => path.resolve(workspaceRoot, p))
    : discoverFailingTraces(workspaceRoot);

  if (tracePaths.length === 0) {
    return {
      status: 'ABSTAINED',
      totalTraces: 0,
      repairedCount: 0,
      abstainedCount: 0,
      failedCount: 0,
      items: [],
      clusters: [],
      executionPassed: true,
      promotedFiles: [],
    };
  }

  const items: BatchRepairItem[] = [];
  const failureObservations: FailureObservation[] = [];
  const intelligence = await bootstrapProjectIntelligence(workspaceRoot);

  // Phase 1: Diagnose all failing traces in parallel
  for (const tracePath of tracePaths) {
    try {
      const proposalRun = await runTraceProposalWorkflow({
        tracePath,
        workspaceRoot,
        enableBrowserInvestigation: input.enableBrowserInvestigation,
        browserUrl: input.browserUrl,
        browserAllowedHosts: input.browserAllowedHosts,
        enableTestExecution: input.enableTestExecution,
      });

      const { correlated, agent } = proposalRun;
      const category = correlated.classification.category;
      const confidence = correlated.classification.confidence;
      const testTitle = correlated.context.failedAction.sourceFile
        ? path.basename(correlated.context.failedAction.sourceFile)
        : 'Unknown Spec';

      failureObservations.push({
        id: path.basename(tracePath, '.zip'),
        repository: path.basename(workspaceRoot),
        testTitle,
        sourceFile: correlated.context.failedAction.sourceFile,
        category,
        action: correlated.context.failedAction.action,
        selector: correlated.context.failedAction.selector,
        errorMessage: correlated.context.failedAction.errorStack?.split('\n')[0] ?? correlated.context.failedAction.action,
        errorStack: correlated.context.failedAction.errorStack,
        tracePath,
      });

      if (correlated.classification.shouldAbstain) {
        items.push({
          tracePath,
          testTitle,
          status: 'ABSTAINED',
          category,
          confidence,
          reason: correlated.classification.abstentionReason ?? correlated.classification.reason ?? 'Abstained by diagnostic policy',
          failedTarget: correlated.context.failedAction.selector,
        });
        continue;
      }

      if (!agent.proposal || agent.proposal.decision === 'ABSTAIN') {
        items.push({
          tracePath,
          testTitle,
          status: 'ABSTAINED',
          category,
          confidence,
          reason: agent.proposal?.reasoningSummary ?? agent.errors.join('; ') ?? 'Proposal abstained',
          failedTarget: correlated.context.failedAction.selector,
        });
        continue;
      }

      const selected = DiagnosticReportGenerator.selectRepairCandidate(correlated, intelligence);
      const proposedLocator = selected?.locatorExpression ?? (agent.proposal.operations[0] as any)?.locator;
      const failedTarget = correlated.context.failedAction.selector ?? (agent.proposal.operations[0] as any)?.target;

      if (!proposedLocator) {
        items.push({
          tracePath,
          testTitle,
          status: 'ABSTAINED',
          category,
          confidence,
          reason: 'No unique candidate locator survived ranking and abstention gates',
          failedTarget,
        });
        continue;
      }

      // Source mapping
      const mapping = await discoverRepairSourceMapping({
        workspaceRoot,
        failedAction: correlated.context.failedAction,
      });

      if (mapping) {
        items.push({
          tracePath,
          testTitle,
          status: 'PROPOSAL_READY',
          category,
          confidence,
          reason: agent.proposal.reasoningSummary,
          failedTarget,
          healedLocator: proposedLocator,
          targetFilePath: mapping.pomFilePath,
          testFilePath: mapping.testFilePath,
          className: mapping.className,
          memberName: mapping.memberName,
          pattern: 'page-object',
          proposal: agent.proposal,
        });
      } else {
        // Fallback: check if the failure is directly in a test spec file
        const sourceFile = correlated.context.failedAction.sourceFile;
        const resolvedSpec = sourceFile ? path.resolve(workspaceRoot, sourceFile) : undefined;
        if (resolvedSpec && fsSync.existsSync(resolvedSpec) && (resolvedSpec.includes('.spec.') || resolvedSpec.includes('.test.'))) {
          items.push({
            tracePath,
            testTitle,
            status: 'PROPOSAL_READY',
            category,
            confidence,
            reason: agent.proposal.reasoningSummary,
            failedTarget,
            healedLocator: proposedLocator,
            targetFilePath: resolvedSpec,
            testFilePath: resolvedSpec,
            pattern: 'inline-locator',
            proposal: agent.proposal,
          });
        } else {
          items.push({
            tracePath,
            testTitle,
            status: 'ABSTAINED',
            category,
            confidence,
            reason: 'Source mapping could not locate a unique Page Object or test file to patch',
            failedTarget,
            healedLocator: proposedLocator,
          });
        }
      }
    } catch (err: any) {
      items.push({
        tracePath,
        status: 'FAILED',
        category: 'INTERNAL_ERROR',
        confidence: 0,
        reason: err?.message ?? String(err),
      });
    }
  }

  const clusters = clusterFailures(failureObservations);
  const proposableItems = items.filter((item) => item.status === 'PROPOSAL_READY');

  if (proposableItems.length === 0 || (!input.execute && !input.autoPromote)) {
    return {
      status: proposableItems.length > 0 ? 'PARTIAL' : (items.every((i) => i.status === 'ABSTAINED') ? 'ABSTAINED' : 'FAILED'),
      totalTraces: items.length,
      repairedCount: 0,
      abstainedCount: items.filter((i) => i.status === 'ABSTAINED').length,
      failedCount: items.filter((i) => i.status === 'FAILED').length,
      items,
      clusters,
    };
  }

  // Phase 2: Batch verification in a SINGLE isolated Git worktree
  const manager = new WorktreeManager(workspaceRoot);
  const batchWorktreeId = input.worktreeId ?? `batch-repair-${crypto.randomUUID().slice(0, 8)}`;
  let worktree: WorktreeInfo;
  try {
    worktree = await manager.createWorktree(batchWorktreeId);
  } catch (err: any) {
    return {
      status: 'FAILED',
      totalTraces: items.length,
      repairedCount: 0,
      abstainedCount: items.filter((i) => i.status === 'ABSTAINED').length,
      failedCount: items.length,
      items: items.map((i) => (i.status === 'PROPOSAL_READY' ? { ...i, status: 'FAILED', reason: `Worktree creation failed: ${err.message}` } : i)),
      clusters,
    };
  }

  let executionPassed = false;
  const promotedFiles: string[] = [];
  const modifiedFileContents = new Map<string, string>(); // relative path -> patched content

  try {
    // Group proposals by target file
    const byTargetFile = new Map<string, BatchRepairItem[]>();
    for (const item of proposableItems) {
      if (!item.targetFilePath) continue;
      const list = byTargetFile.get(item.targetFilePath) ?? [];
      list.push(item);
      byTargetFile.set(item.targetFilePath, list);
    }

    const astPatcher = new AstPatcher();
    const statementPatcher = new StatementPatcher();

    // Sequentially patch each file inside the worktree
    for (const [targetFile, targetItems] of byTargetFile.entries()) {
      const relTarget = path.relative(workspaceRoot, targetFile);
      const worktreeTarget = path.resolve(worktree.worktreePath, relTarget);
      if (!fsSync.existsSync(worktreeTarget)) {
        for (const it of targetItems) {
          it.status = 'REJECTED';
          it.reason = `Worktree target file does not exist: '${relTarget}'`;
        }
        continue;
      }

      let currentSource = await fs.readFile(worktreeTarget, 'utf8');

      for (const item of targetItems) {
        try {
          if (item.pattern === 'page-object' && item.className && item.memberName && item.healedLocator) {
            const patchRes = astPatcher.patchPageObjectInMemory(currentSource, {
              className: item.className,
              memberName: item.memberName,
              replacementExpression: item.healedLocator,
            });
            currentSource = patchRes.patchedSource;
            item.fullDiff = patchRes.diff;
          } else if (item.pattern === 'inline-locator' && item.failedTarget && item.healedLocator) {
            const patchRes = statementPatcher.patchStatementInMemory(currentSource, {
              kind: 'replace-inline-locator',
              oldLocatorText: item.failedTarget,
              newLocatorExpression: item.healedLocator,
            }, path.basename(relTarget));
            currentSource = patchRes.patchedSource;
            item.fullDiff = patchRes.diff;
          }
        } catch (patchErr: any) {
          item.status = 'REJECTED';
          item.reason = `AST patching rejected: ${patchErr?.message ?? String(patchErr)}`;
        }
      }

      // Safety checks: AST Allowlist & Grammar validation
      let allAllowed = true;
      for (const item of targetItems) {
        if (item.healedLocator) {
          const checkGrammar = DiffAllowlistValidator.validateLocatorGrammar(item.healedLocator);
          if (!checkGrammar.isValid) {
            item.status = 'REJECTED';
            item.reason = `Invalid locator grammar: ${checkGrammar.reason}`;
            allAllowed = false;
          }
        }
      }
      if (!allAllowed) continue;

      // Save patched content to worktree and record for promotion
      await fs.writeFile(worktreeTarget, currentSource, 'utf8');
      modifiedFileContents.set(relTarget, currentSource);
    }

    // Collect all impacted test spec paths
    const impactedSpecs = [...new Set(
      proposableItems
        .filter((it) => it.status === 'PROPOSAL_READY')
        .map((it) => it.testFilePath)
        .filter(Boolean) as string[],
    )];

    if (impactedSpecs.length > 0) {
      // Verify each impacted spec file in the worktree independently to prevent cross-spec interference
      for (const specPath of impactedSpecs) {
        const relSpec = path.relative(workspaceRoot, specPath).replace(/\\/g, '/');
        const specItems = proposableItems.filter((it) => it.testFilePath === specPath && it.status === 'PROPOSAL_READY');
        if (specItems.length === 0) continue;

        const testArgs = ['playwright', 'test', relSpec, '--reporter=line'];
        if (input.configPath) {
          testArgs.push('--config', path.relative(workspaceRoot, input.configPath).replace(/\\/g, '/'));
        }

        const execResult = await ExecutionRunner.run('npx', {
          cwd: worktree.worktreePath,
          args: testArgs,
          timeoutMs: 60000,
        });

        const passedMatch = execResult.stdout.match(/(\d+)\s+passed/i);
        const passedCount = passedMatch ? parseInt(passedMatch[1] ?? '0', 10) : 0;
        const specPassed = execResult.exitCode === 0 && passedCount > 0 && !execResult.timedOut;

        for (const it of specItems) {
          it.status = specPassed ? 'VERIFIED' : 'VERIFICATION_FAILED';
          if (!specPassed) {
            it.reason = execResult.timedOut ? 'Execution timed out in worktree' : `Worktree Playwright tests failed (exitCode=${execResult.exitCode})`;
          }
        }
      }

      // Phase 3: Atomic Promotion for files where all related items verified green
      if (input.autoPromote) {
        for (const [relPath, content] of modifiedFileContents.entries()) {
          const fullTarget = path.resolve(workspaceRoot, relPath);
          const relatedItems = proposableItems.filter((it) => it.targetFilePath && path.resolve(workspaceRoot, it.targetFilePath) === fullTarget);
          const allVerified = relatedItems.length > 0 && relatedItems.every((it) => it.status === 'VERIFIED');
          if (allVerified) {
            const workspaceDest = path.resolve(workspaceRoot, relPath);
            await fs.mkdir(path.dirname(workspaceDest), { recursive: true });
            await fs.writeFile(workspaceDest, content, 'utf8');
            promotedFiles.push(relPath);
            for (const it of relatedItems) {
              it.status = 'PROMOTED';
            }
          }
        }
      }
    }
  } finally {
    // Always clean up isolated worktree
    await manager.destroyWorktree(batchWorktreeId);
  }

  const repairedCount = items.filter((i) => i.status === 'VERIFIED' || i.status === 'PROMOTED').length;
  const abstainedCount = items.filter((i) => i.status === 'ABSTAINED').length;
  const failedCount = items.filter((i) => i.status === 'FAILED' || i.status === 'VERIFICATION_FAILED' || i.status === 'REJECTED').length;

  const status = repairedCount > 0 && failedCount === 0
    ? 'COMPLETED'
    : repairedCount > 0
      ? 'PARTIAL'
      : (abstainedCount > 0 && repairedCount === 0 ? 'ABSTAINED' : 'FAILED');

  return {
    status,
    totalTraces: items.length,
    repairedCount,
    abstainedCount,
    failedCount,
    items,
    clusters,
    worktree,
    executionPassed,
    promotedFiles,
  };
}
