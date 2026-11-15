import fsSync from 'node:fs';
import path from 'node:path';
import { ArchiveReader } from '../trace/archive-reader.js';
import { runBatchRepairWorkflow, BatchRepairItem } from '../intelligence/batch-repair-workflow.js';
import { runDirectCodeRepair } from './direct-code-repair.js';

export type RepairMode = 'hybrid' | 'deterministic' | 'llm';

export interface HybridRepairProgressEvent {
  index: number;
  total: number;
  tracePath: string;
  stage:
    | 'ingesting'
    | 'tier1_evaluating'
    | 'tier1_verified'
    | 'tier2_fallback'
    | 'tier2_authoring'
    | 'tier2_verified'
    | 'tier2_proposal'
    | 'abstained'
    | 'failed';
  message: string;
  tier?: 'tier1_deterministic' | 'tier2_llm' | 'negative_control' | undefined;
  tokens?: number | undefined;
  costUsd?: number | undefined;
  durationMs?: number | undefined;
}

export interface HybridRepairInput {
  workspaceRoot?: string | undefined;
  tracePaths?: string[] | undefined;
  execute?: boolean | undefined;
  autoPromote?: boolean | undefined;
  configPath?: string | undefined;
  mode?: RepairMode | undefined;
  onProgress?: ((event: HybridRepairProgressEvent) => void) | undefined;
}

export interface HybridRepairItem {
  tracePath: string;
  testTitle: string;
  status: 'REPAIRED_AND_VERIFIED' | 'PROPOSAL_READY' | 'ABSTAINED' | 'FAILED' | 'VERIFICATION_FAILED';
  tier: 'tier1_deterministic' | 'tier2_llm' | 'negative_control';
  targetFilePath?: string | undefined;
  testFilePath?: string | undefined;
  healedLocator?: string | undefined;
  analysis?: string | undefined;
  diff?: string | undefined;
  reason?: string | undefined;
  telemetry: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    inferenceMs: number;
    executionMs: number;
    totalMs: number;
  };
}

export interface HybridRepairResult {
  mode: RepairMode;
  totalTraces: number;
  repairedCount: number;
  tier1RepairedCount: number;
  tier2RepairedCount: number;
  abstainedCount: number;
  failedCount: number;
  items: HybridRepairItem[];
  promotedFiles: string[];
  aggregateTelemetry: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    totalDurationMs: number;
  };
}

function discoverFailingTraces(workspaceRoot: string): string[] {
  const resultsDir = path.resolve(workspaceRoot, 'test-results');
  if (!fsSync.existsSync(resultsDir)) return [];
  const traces: string[] = [];
  const entries = fsSync.readdirSync(resultsDir, { recursive: true });
  for (const entry of entries) {
    const full = path.join(resultsDir, String(entry));
    if (full.endsWith('.zip')) {
      try {
        const disc = ArchiveReader.findTraceFileEntries(full);
        if (disc.hasFailure) {
          traces.push(full);
        }
      } catch {}
    }
  }
  return traces;
}

function isNegativeControl(reason?: string): boolean {
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return (
    lower.includes('negative control') ||
    lower.includes('backend server failure') ||
    lower.includes('backend defect') ||
    lower.includes('http 5') ||
    lower.includes('http 404') ||
    lower.includes('network offline')
  );
}

/**
 * The Hybrid Repair Engine: Coordinates Tier 1 (fast deterministic AST/DOM resolution)
 * and Tier 2 (semantic LLM code authoring) in a unified, cost-effective cascade.
 */
export async function runHybridRepair(input: HybridRepairInput): Promise<HybridRepairResult> {
  const started = Date.now();
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const mode = input.mode ?? 'hybrid';

  let tracePaths = input.tracePaths;
  if (!tracePaths || tracePaths.length === 0) {
    tracePaths = discoverFailingTraces(workspaceRoot);
  } else {
    tracePaths = tracePaths.map((p) => path.resolve(workspaceRoot, p));
  }

  if (tracePaths.length === 0) {
    return {
      mode,
      totalTraces: 0,
      repairedCount: 0,
      tier1RepairedCount: 0,
      tier2RepairedCount: 0,
      abstainedCount: 0,
      failedCount: 0,
      items: [],
      promotedFiles: [],
      aggregateTelemetry: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalDurationMs: Date.now() - started,
      },
    };
  }

  const items: HybridRepairItem[] = [];
  const promotedFilesSet = new Set<string>();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  // -------------------------------------------------------------
  // PURE LLM MODE: Skip Tier 1 completely, run Tier 2 directly
  // -------------------------------------------------------------
  if (mode === 'llm') {
    for (let i = 0; i < tracePaths.length; i++) {
      const tracePath = tracePaths[i]!;
      input.onProgress?.({
        index: i + 1,
        total: tracePaths.length,
        tracePath,
        stage: 'tier2_authoring',
        message: 'Authoring direct code repair with LLM...',
        tier: 'tier2_llm',
      });

      try {
        const res = await runDirectCodeRepair({
          tracePath,
          workspaceRoot,
          execute: input.execute,
          autoPromote: input.autoPromote,
          configPath: input.configPath,
        });

        const testTitle = res.testFilePath ? path.basename(res.testFilePath) : path.basename(tracePath);
        const isNeg = res.status === 'ABSTAINED' && isNegativeControl(res.reason);

        if (res.status === 'REPAIRED_AND_VERIFIED' && res.targetFilePath && input.autoPromote) {
          promotedFilesSet.add(path.relative(workspaceRoot, res.targetFilePath));
        }

        totalPromptTokens += res.telemetry.promptTokens;
        totalCompletionTokens += res.telemetry.completionTokens;
        totalTokens += res.telemetry.totalTokens;
        totalCostUsd += res.telemetry.estimatedCostUsd;

        items.push({
          tracePath,
          testTitle,
          status: res.status,
          tier: isNeg ? 'negative_control' : 'tier2_llm',
          targetFilePath: res.targetFilePath,
          testFilePath: res.testFilePath,
          analysis: res.analysis,
          diff: res.diff,
          reason: res.reason,
          telemetry: {
            promptTokens: res.telemetry.promptTokens,
            completionTokens: res.telemetry.completionTokens,
            totalTokens: res.telemetry.totalTokens,
            costUsd: res.telemetry.estimatedCostUsd,
            inferenceMs: res.telemetry.inferenceMs,
            executionMs: res.telemetry.executionMs,
            totalMs: res.telemetry.totalMs,
          },
        });

        input.onProgress?.({
          index: i + 1,
          total: tracePaths.length,
          tracePath,
          stage: res.status === 'REPAIRED_AND_VERIFIED' ? 'tier2_verified' : (res.status === 'ABSTAINED' ? 'abstained' : 'failed'),
          message: res.reason ?? res.status,
          tier: isNeg ? 'negative_control' : 'tier2_llm',
          tokens: res.telemetry.totalTokens,
          costUsd: res.telemetry.estimatedCostUsd,
        });
      } catch (err: any) {
        items.push({
          tracePath,
          testTitle: path.basename(tracePath),
          status: 'FAILED',
          tier: 'tier2_llm',
          reason: err?.message ?? String(err),
          telemetry: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            inferenceMs: 0,
            executionMs: 0,
            totalMs: 0,
          },
        });

        input.onProgress?.({
          index: i + 1,
          total: tracePaths.length,
          tracePath,
          stage: 'failed',
          message: err?.message ?? String(err),
          tier: 'tier2_llm',
        });
      }
    }

    return {
      mode,
      totalTraces: items.length,
      repairedCount: items.filter((i) => i.status === 'REPAIRED_AND_VERIFIED').length,
      tier1RepairedCount: 0,
      tier2RepairedCount: items.filter((i) => i.status === 'REPAIRED_AND_VERIFIED').length,
      abstainedCount: items.filter((i) => i.status === 'ABSTAINED').length,
      failedCount: items.filter((i) => i.status === 'FAILED' || i.status === 'VERIFICATION_FAILED').length,
      items,
      promotedFiles: Array.from(promotedFilesSet),
      aggregateTelemetry: {
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        totalCostUsd,
        totalDurationMs: Date.now() - started,
      },
    };
  }

  // -------------------------------------------------------------
  // TIER 1 (DETERMINISTIC FAST-PATH)
  // -------------------------------------------------------------
  input.onProgress?.({
    index: 1,
    total: tracePaths.length,
    tracePath: tracePaths[0]!,
    stage: 'tier1_evaluating',
    message: 'Evaluating Tier 1 deterministic AST/DOM resolution...',
    tier: 'tier1_deterministic',
  });

  const tier1Batch = await runBatchRepairWorkflow({
    workspaceRoot,
    tracePaths,
    execute: input.execute,
    autoPromote: input.autoPromote,
    configPath: input.configPath,
  });

  const unresolvedTraces: Array<{ tracePath: string; previousItem?: BatchRepairItem }> = [];

  for (let i = 0; i < tier1Batch.items.length; i++) {
    const item = tier1Batch.items[i]!;
    const isNeg = item.status === 'ABSTAINED' && isNegativeControl(item.reason);

    const title = item.testTitle ?? path.basename(item.tracePath);

    if (item.status === 'VERIFIED' || item.status === 'PROMOTED') {
      // Tier 1 succeeded!
      if (item.targetFilePath && input.autoPromote) {
        promotedFilesSet.add(path.relative(workspaceRoot, item.targetFilePath));
      }
      items.push({
        tracePath: item.tracePath,
        testTitle: title,
        status: 'REPAIRED_AND_VERIFIED',
        tier: 'tier1_deterministic',
        targetFilePath: item.targetFilePath,
        testFilePath: item.testFilePath,
        healedLocator: item.healedLocator,
        diff: item.fullDiff,
        reason: item.reason ?? 'Verified green via Tier 1 deterministic engine in isolated worktree',
        telemetry: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          inferenceMs: 0,
          executionMs: 0,
          totalMs: 0,
        },
      });

      input.onProgress?.({
        index: i + 1,
        total: tier1Batch.items.length,
        tracePath: item.tracePath,
        stage: 'tier1_verified',
        message: `Verified and healed via Tier 1 (${item.healedLocator})`,
        tier: 'tier1_deterministic',
        tokens: 0,
        costUsd: 0,
      });
    } else if (item.status === 'PROPOSAL_READY' && !input.execute) {
      // Proposal ready in read-only mode
      items.push({
        tracePath: item.tracePath,
        testTitle: title,
        status: 'PROPOSAL_READY',
        tier: 'tier1_deterministic',
        targetFilePath: item.targetFilePath,
        testFilePath: item.testFilePath,
        healedLocator: item.healedLocator,
        reason: item.reason,
        telemetry: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          inferenceMs: 0,
          executionMs: 0,
          totalMs: 0,
        },
      });
    } else if (isNeg) {
      // Negative control triggered: legitimate abstention, do not route to Tier 2
      items.push({
        tracePath: item.tracePath,
        testTitle: title,
        status: 'ABSTAINED',
        tier: 'negative_control',
        reason: item.reason,
        telemetry: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          inferenceMs: 0,
          executionMs: 0,
          totalMs: 0,
        },
      });

      input.onProgress?.({
        index: i + 1,
        total: tier1Batch.items.length,
        tracePath: item.tracePath,
        stage: 'abstained',
        message: item.reason ?? 'Negative control abstention',
        tier: 'negative_control',
      });
    } else {
      // Unresolved by Tier 1: Candidate for Tier 2 fallback if mode === 'hybrid'
      if (mode === 'hybrid') {
        unresolvedTraces.push({ tracePath: item.tracePath, previousItem: item });
      } else {
        // Pure deterministic mode: keep failure/abstention
        items.push({
          tracePath: item.tracePath,
          testTitle: title,
          status: item.status === 'VERIFICATION_FAILED' ? 'VERIFICATION_FAILED' : (item.status === 'ABSTAINED' ? 'ABSTAINED' : 'FAILED'),
          tier: 'tier1_deterministic',
          targetFilePath: item.targetFilePath,
          testFilePath: item.testFilePath,
          healedLocator: item.healedLocator,
          reason: item.reason,
          telemetry: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            inferenceMs: 0,
            executionMs: 0,
            totalMs: 0,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------
  // TIER 2 (SEMANTIC LLM FALLBACK FOR HYBRID MODE)
  // -------------------------------------------------------------
  if (mode === 'hybrid' && unresolvedTraces.length > 0) {
    for (let j = 0; j < unresolvedTraces.length; j++) {
      const { tracePath, previousItem } = unresolvedTraces[j]!;

      input.onProgress?.({
        index: items.length + 1,
        total: tracePaths.length,
        tracePath,
        stage: 'tier2_fallback',
        message: `Cascading to Tier 2 (LLM Authoring) because Tier 1 was inconclusive (${previousItem?.reason ?? 'unresolved'})...`,
        tier: 'tier2_llm',
      });

      try {
        const res = await runDirectCodeRepair({
          tracePath,
          workspaceRoot,
          execute: input.execute,
          autoPromote: input.autoPromote,
          configPath: input.configPath,
        });

        const testTitle = res.testTitle ?? (res.testFilePath ? path.basename(res.testFilePath) : (previousItem?.testTitle ?? path.basename(tracePath)));
        const isNeg = res.status === 'ABSTAINED' && isNegativeControl(res.reason);

        if (res.status === 'REPAIRED_AND_VERIFIED' && res.targetFilePath && input.autoPromote) {
          promotedFilesSet.add(path.relative(workspaceRoot, res.targetFilePath));
        }

        totalPromptTokens += res.telemetry.promptTokens;
        totalCompletionTokens += res.telemetry.completionTokens;
        totalTokens += res.telemetry.totalTokens;
        totalCostUsd += res.telemetry.estimatedCostUsd;

        items.push({
          tracePath,
          testTitle,
          status: res.status,
          tier: isNeg ? 'negative_control' : 'tier2_llm',
          targetFilePath: res.targetFilePath,
          testFilePath: res.testFilePath,
          analysis: res.analysis,
          diff: res.diff,
          reason: res.reason,
          telemetry: {
            promptTokens: res.telemetry.promptTokens,
            completionTokens: res.telemetry.completionTokens,
            totalTokens: res.telemetry.totalTokens,
            costUsd: res.telemetry.estimatedCostUsd,
            inferenceMs: res.telemetry.inferenceMs,
            executionMs: res.telemetry.executionMs,
            totalMs: res.telemetry.totalMs,
          },
        });

        input.onProgress?.({
          index: items.length,
          total: tracePaths.length,
          tracePath,
          stage: res.status === 'REPAIRED_AND_VERIFIED'
            ? 'tier2_verified'
            : res.status === 'PROPOSAL_READY'
            ? 'tier2_proposal'
            : res.status === 'ABSTAINED'
            ? 'abstained'
            : 'failed',
          message: res.analysis ?? res.reason ?? res.status,
          tier: isNeg ? 'negative_control' : 'tier2_llm',
          tokens: res.telemetry.totalTokens,
          costUsd: res.telemetry.estimatedCostUsd,
        });
      } catch (err: any) {
        items.push({
          tracePath,
          testTitle: previousItem?.testTitle ?? path.basename(tracePath),
          status: 'FAILED',
          tier: 'tier2_llm',
          reason: err?.message ?? String(err),
          telemetry: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            inferenceMs: 0,
            executionMs: 0,
            totalMs: 0,
          },
        });

        input.onProgress?.({
          index: items.length,
          total: tracePaths.length,
          tracePath,
          stage: 'failed',
          message: err?.message ?? String(err),
          tier: 'tier2_llm',
        });
      }
    }
  }

  const tier1RepairedCount = items.filter((i) => i.status === 'REPAIRED_AND_VERIFIED' && i.tier === 'tier1_deterministic').length;
  const tier2RepairedCount = items.filter((i) => i.status === 'REPAIRED_AND_VERIFIED' && i.tier === 'tier2_llm').length;

  return {
    mode,
    totalTraces: items.length,
    repairedCount: tier1RepairedCount + tier2RepairedCount,
    tier1RepairedCount,
    tier2RepairedCount,
    abstainedCount: items.filter((i) => i.status === 'ABSTAINED').length,
    failedCount: items.filter((i) => i.status === 'FAILED' || i.status === 'VERIFICATION_FAILED').length,
    items,
    promotedFiles: Array.from(promotedFilesSet),
    aggregateTelemetry: {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd,
      totalDurationMs: Date.now() - started,
    },
  };
}
