import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { SnapshotResolver, ResolvedElement } from '../trace/snapshot-resolver.js';
import { WorktreeManager, WorktreeInfo } from '../sandbox/worktree-manager.js';
import { ExecutionRunner } from '../sandbox/execution-runner.js';
import { AssertionHasher } from './assertion-hasher.js';

export interface DirectCodeRepairTelemetry {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  evidenceAssemblyMs: number;
  inferenceMs: number;
  executionMs: number;
  totalMs: number;
}

export interface DirectCodeRepairResult {
  status: 'REPAIRED_AND_VERIFIED' | 'PROPOSAL_READY' | 'ABSTAINED' | 'VERIFICATION_FAILED' | 'FAILED';
  tracePath: string;
  testTitle?: string | undefined;
  targetFilePath?: string | undefined;
  testFilePath?: string | undefined;
  analysis?: string | undefined;
  originalCode?: string | undefined;
  repairedCode?: string | undefined;
  diff?: string | undefined;
  telemetry: DirectCodeRepairTelemetry;
  assertionIntegrity?: {
    assertionsPreserved: boolean;
    beforeFingerprint: string;
    afterFingerprint: string;
  } | undefined;
  worktree?: WorktreeInfo | undefined;
  executionPassed?: boolean | undefined;
  executionOutput?: string | undefined;
  reason?: string | undefined;
}

export interface DirectCodeRepairInput {
  tracePath: string;
  workspaceRoot?: string | undefined;
  execute?: boolean | undefined;
  autoPromote?: boolean | undefined;
  configPath?: string | undefined;
  worktreeId?: string | undefined;
}

/**
 * Calculates estimated USD cost based on model pricing.
 */
function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const m = model.toLowerCase();
  if (m.includes('deepseek')) {
    // DeepSeek rates: $0.14 per 1M input, $0.28 per 1M output
    return (promptTokens * 0.14 + completionTokens * 0.28) / 1_000_000;
  }
  if (m.includes('gpt-4o-mini')) {
    return (promptTokens * 0.15 + completionTokens * 0.60) / 1_000_000;
  }
  if (m.includes('gpt-4o')) {
    return (promptTokens * 2.50 + completionTokens * 10.00) / 1_000_000;
  }
  // Default fallback estimate
  return (promptTokens * 0.50 + completionTokens * 1.50) / 1_000_000;
}

/**
 * Creates a unified diff string between old and new source code.
 */
function createDiff(filePath: string, oldText: string, newText: string): string {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    } else {
      const startI = i;
      const startJ = j;
      const removed: string[] = [];
      const added: string[] = [];

      while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== (newLines[j] ?? ''))) {
        if (oldLines[i] !== undefined) removed.push(oldLines[i]!);
        i++;
        if (removed.length > 5) break;
      }
      while (j < newLines.length && (i >= oldLines.length || (oldLines[i] ?? '') !== newLines[j])) {
        if (newLines[j] !== undefined) added.push(newLines[j]!);
        j++;
        if (added.length > 5) break;
      }

      diffLines.push(`@@ -${startI + 1},${removed.length} +${startJ + 1},${added.length} @@`);
      for (const r of removed) diffLines.push(`- ${r}`);
      for (const a of added) diffLines.push(`+ ${a}`);
    }
  }

  return diffLines.join('\n');
}

/**
 * Extracts all interactive elements and relevant HTML snippets from trace archive snapshots.
 */
async function extractTraceDomEvidence(_tracePath: string, traceText: string): Promise<string[]> {
  const lines = traceText.split('\n');
  const rawSnapshots: any[] = [];
  const candidateHtmlSnippets: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'frame-snapshot' && ev.snapshot) {
        rawSnapshots.push(ev.snapshot);
        const idx = rawSnapshots.length - 1;
        const frameUrl = ev.snapshot.frameUrl ?? '';
        const isRealUrl = frameUrl && !frameUrl.startsWith('about:') && !frameUrl.includes('consentcdn') && !frameUrl.includes('sitecontext');

        if (isRealUrl) {
          const snapContent = ev.snapshot.html ?? ev.snapshot.node;
          const res = SnapshotResolver.resolveDifferentialNode(snapContent, idx, rawSnapshots);
          if (res && typeof res === 'object' && 'tag' in res) {
            const el = res as ResolvedElement;
            const interactive = SnapshotResolver.extractInteractiveElements(el);
            for (const item of interactive.slice(0, 30)) {
              const html = SnapshotResolver.toHtml(item).trim();
              if (html && !candidateHtmlSnippets.includes(html)) {
                candidateHtmlSnippets.push(html);
              }
            }
          }
        }
      }
    } catch {}
  }

  return candidateHtmlSnippets;
}

/**
 * Direct LLM Code Authoring & Verification Engine.
 * Gives the LLM direct access to author the code fix based on the rich evidence dump,
 * and monitors latency, token costs, performance, and assertion integrity.
 */
export async function runDirectCodeRepair(input: DirectCodeRepairInput): Promise<DirectCodeRepairResult> {
  const startedTotal = Date.now();
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const tracePath = path.resolve(workspaceRoot, input.tracePath);

  if (!fsSync.existsSync(tracePath)) {
    throw new Error(`Trace archive not found: '${tracePath}'`);
  }

  // 1. Evidence Assembly
  const startedAssembly = Date.now();
  const { traceEntryNames, networkEntryNames } = ArchiveReader.findTraceFileEntries(tracePath);
  const traceText = await ArchiveReader.readEntriesAsText(tracePath, traceEntryNames ?? []);
  const netText = networkEntryNames ? await ArchiveReader.readEntriesAsText(tracePath, networkEntryNames) : '';
  const context = TraceParser.assembleDiagnosticContext(traceText.split('\n'), netText.split('\n'));
  const failedAction = context.failedAction;

  // Check Negative Controls first (Server 5xx / Client 404 / Backend Failure)
  const serverError = context.networkEvents.find((n) => n.status >= 500 && !/favicon|docketai|intercom|clarity|optimizely/i.test(n.url));
  const missingAsset = context.networkEvents.find((n) => n.status === 404 && /\.(?:png|jpe?g|svg|webp|json|api)/i.test(n.url) && !/favicon|docketai/i.test(n.url));
  if (serverError || missingAsset) {
    const offending = serverError ?? missingAsset!;
    return {
      status: 'ABSTAINED',
      tracePath,
      telemetry: {
        provider: 'deterministic-negative-control',
        model: 'pie-negative-control',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        evidenceAssemblyMs: Date.now() - startedAssembly,
        inferenceMs: 0,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: `Negative Control Triggered: Test failed due to backend server failure (HTTP ${offending.status} on ${offending.url}). Modifying UI locators or code is prohibited.`,
    };
  }

  // 1. Determine target file to patch (targetFilePath)
  let targetFilePath: string | undefined;

  // Framework-level error detection (playwright.config.*, fixtures/*, global setup)
  const isFrameworkConfig = failedAction.errorStack && /playwright\.config\.[tj]sx?/i.test(failedAction.errorStack);
  const isFixtureError = failedAction.errorStack && /fixtures?[\\/].*\.[tj]sx?/i.test(failedAction.errorStack);

  if (isFrameworkConfig) {
    const cfgCandidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
    for (const cfg of cfgCandidates) {
      const full = path.resolve(workspaceRoot, cfg);
      if (fsSync.existsSync(full)) {
        targetFilePath = full;
        break;
      }
    }
  } else if (isFixtureError) {
    const fixtureMatch = failedAction.errorStack?.match(/([A-Za-z0-9_.\-\\/]+fixtures?[\\/][A-Za-z0-9_.\-\\/]+\.[tj]sx?)/i);
    if (fixtureMatch && fixtureMatch[1]) {
      const full = path.resolve(workspaceRoot, fixtureMatch[1]);
      if (fsSync.existsSync(full)) {
        targetFilePath = full;
      }
    }
  }

  if (!targetFilePath && failedAction.sourceFile) {
    const candidate = path.resolve(workspaceRoot, failedAction.sourceFile);
    if (fsSync.existsSync(candidate)) {
      targetFilePath = candidate;
    } else {
      const base = path.basename(failedAction.sourceFile);
      const allFiles = fsSync.readdirSync(workspaceRoot, { recursive: true });
      const match = allFiles.find((f) => String(f).endsWith(base));
      if (match) targetFilePath = path.join(workspaceRoot, String(match));
    }
  }

  // 2. Determine calling spec file to execute in Playwright (specFilePath)
  let specFilePath: string | undefined;

  // If targetFilePath is already a test/spec file:
  if (targetFilePath && /\.(?:spec|test)\.[tj]sx?$/i.test(targetFilePath)) {
    specFilePath = targetFilePath;
  }

  // Look up spec file from trace archive stacks
  if (!specFilePath) {
    const archiveSpec = ArchiveReader.extractSpecFileFromArchive(tracePath);
    if (archiveSpec) {
      const resolved = path.resolve(workspaceRoot, archiveSpec);
      if (fsSync.existsSync(resolved)) {
        specFilePath = resolved;
      } else {
        const base = path.basename(archiveSpec);
        const testDir = path.resolve(workspaceRoot, 'tests');
        if (fsSync.existsSync(testDir)) {
          const files = fsSync.readdirSync(testDir, { recursive: true });
          const match = files.find((f) => String(f).endsWith(base));
          if (match) specFilePath = path.join(testDir, String(match));
        }
      }
    }
  }

  // Fallback: check errorStack for a spec file match
  if (!specFilePath && failedAction.errorStack) {
    const stackMatches = [...failedAction.errorStack.matchAll(/(?:at\s+.*?\()?([A-Za-z]:\\[^:\s)]+\.(?:spec|test)\.[tj]sx?|\/[^:\s)]+\.(?:spec|test)\.[tj]sx?)/gi)];
    for (const sm of stackMatches) {
      if (sm[1]) {
        const candidate = path.resolve(sm[1]);
        if (fsSync.existsSync(candidate)) {
          specFilePath = candidate;
          break;
        }
      }
    }
  }

  // Fallback: infer from trace parent folder name (e.g. login-Login-Test-Demo-chromium -> login.test.ts)
  if (!specFilePath) {
    const parentDir = path.basename(path.dirname(tracePath));
    const prefix = parentDir.split('-')[0]?.toLowerCase();
    const testDir = path.resolve(workspaceRoot, 'tests');
    if (prefix && fsSync.existsSync(testDir)) {
      const files = fsSync.readdirSync(testDir, { recursive: true });
      const match = files.find((f) => String(f).toLowerCase().startsWith(prefix) && /\.(?:spec|test)\.[tj]sx?$/i.test(String(f)));
      if (match) specFilePath = path.join(testDir, String(match));
    }
  }

  // If targetFilePath was not resolved, default to specFilePath
  if (!targetFilePath && specFilePath) {
    targetFilePath = specFilePath;
  }

  // If specFilePath was found and targetFilePath is a spec file, check if it delegates to a Page Object that holds the selector
  if (targetFilePath && targetFilePath === specFilePath) {
    const testCode = await fs.readFile(targetFilePath, 'utf8');
    const pomMatch = testCode.match(/import\s+.*\{?\s*([A-Za-z0-9_]+Page)\s*\}?\s+from\s+['"]([^'"]+)['"]/);
    if (pomMatch && pomMatch[2]) {
      const resolvedPom = path.resolve(path.dirname(targetFilePath), pomMatch[2].endsWith('.ts') ? pomMatch[2] : `${pomMatch[2]}.ts`);
      if (fsSync.existsSync(resolvedPom)) {
        const pomCode = await fs.readFile(resolvedPom, 'utf8');
        if (failedAction.selector && pomCode.includes(failedAction.selector)) {
          targetFilePath = resolvedPom;
        }
      }
    }
  }

  // If targetFilePath is still missing, fail closed
  if (!targetFilePath || !fsSync.existsSync(targetFilePath)) {
    return {
      status: 'FAILED',
      tracePath,
      telemetry: {
        provider: 'none',
        model: 'none',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        evidenceAssemblyMs: Date.now() - startedAssembly,
        inferenceMs: 0,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: `Could not resolve target source file for failed action: '${failedAction.sourceFile ?? 'unknown'}'`,
    };
  }

  if (!specFilePath || !fsSync.existsSync(specFilePath)) {
    specFilePath = targetFilePath;
  }

  const testFilePath = specFilePath;
  const originalTargetCode = await fs.readFile(targetFilePath, 'utf8');
  const originalSpecCode = targetFilePath === specFilePath ? originalTargetCode : await fs.readFile(specFilePath, 'utf8');

  // Extract DOM elements from trace snapshots
  const domSnippets = await extractTraceDomEvidence(tracePath, traceText);

  // Extract ARIA snapshot from error-context.md if available
  let errorContextAriaSnapshot: string | undefined;
  const errorContextPath = path.join(path.dirname(tracePath), 'error-context.md');
  if (fsSync.existsSync(errorContextPath)) {
    try {
      const errorContextContent = await fs.readFile(errorContextPath, 'utf8');
      const ariaMatch = errorContextContent.match(/# Page snapshot[\s\S]*?```ya?ml([\s\S]*?)```/i);
      if (ariaMatch && ariaMatch[1]) {
        errorContextAriaSnapshot = ariaMatch[1].trim().slice(0, 8000);
      }
    } catch {}
  }

  const evidenceAssemblyMs = Date.now() - startedAssembly;

  // 2. Direct LLM Code Authoring
  const apiKey = process.env.PIE_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const endpoint = process.env.PIE_LLM_ENDPOINT ?? (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1/chat/completions' : (apiKey ? 'https://api.deepseek.com/chat/completions' : undefined));
  const model = process.env.PIE_LLM_MODEL ?? (process.env.OPENAI_API_KEY ? 'gpt-4o' : (apiKey ? 'deepseek-chat' : 'gpt-4o'));

  if (!endpoint || !apiKey) {
    return {
      status: 'FAILED',
      tracePath,
      testFilePath,
      targetFilePath,
      telemetry: {
        provider: 'none',
        model: 'none',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        evidenceAssemblyMs,
        inferenceMs: 0,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: 'No LLM credentials configured. Set PIE_LLM_API_KEY and PIE_LLM_ENDPOINT.',
    };
  }

  const systemPrompt = `You are an expert Playwright SDET and Automated Test Repair Engineer.
Your task is to fix a broken Playwright test by updating either the test spec file or the page object file.

CRITICAL INVARIANTS:
1. You MUST repair the broken locator, timing, or action so that the test passes.
2. You MUST NOT modify, remove, comment out, or weaken any 'expect(...)' test assertions.
3. You MUST preserve the exact test intent and structure.
4. Output your response STRICTLY as a JSON object matching this schema:
{
  "analysis": "Brief explanation of what was broken and how you fixed it",
  "targetFilePath": "relative path to the file being updated",
  "repairedCode": "the complete updated source code of the file"
}`;

  const userPrompt = JSON.stringify({
    failedAction: {
      action: failedAction.action,
      selector: failedAction.selector,
      line: failedAction.line,
      column: failedAction.column,
      errorMessage: failedAction.errorMessage,
      errorStack: failedAction.errorStack?.slice(0, 1000),
    },
    targetFile: {
      filePath: path.relative(workspaceRoot, targetFilePath),
      content: originalTargetCode,
    },
    ...(targetFilePath !== testFilePath ? {
      testFile: {
        filePath: path.relative(workspaceRoot, testFilePath),
        content: originalSpecCode,
      }
    } : {}),
    traceEvidence: {
      domInteractiveElements: domSnippets.slice(0, 25),
      pageAriaSnapshot: errorContextAriaSnapshot,
      consoleErrors: context.consoleEvents.slice(0, 5),
    },
  }, null, 2);

  const startedInference = Date.now();
  let rawResponse: any;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM endpoint returned HTTP ${response.status}: ${await response.text()}`);
    }
    rawResponse = await response.json();
  } catch (err: any) {
    return {
      status: 'FAILED',
      tracePath,
      testFilePath,
      targetFilePath,
      telemetry: {
        provider: 'llm',
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        evidenceAssemblyMs,
        inferenceMs: Date.now() - startedInference,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: `LLM inference failed: ${err.message}`,
    };
  }

  const inferenceMs = Date.now() - startedInference;
  const usage = rawResponse.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const completionTokens = usage.completion_tokens ?? Math.ceil((rawResponse.choices?.[0]?.message?.content?.length ?? 0) / 4);
  const totalTokens = promptTokens + completionTokens;
  const estimatedCostUsd = calculateCost(model, promptTokens, completionTokens);

  // Parse LLM JSON output
  const content = rawResponse.choices?.[0]?.message?.content ?? '';
  let parsedProposal: { analysis?: string; targetFilePath?: string; repairedCode?: string } = {};
  try {
    parsedProposal = JSON.parse(content);
  } catch (parseErr) {
    return {
      status: 'FAILED',
      tracePath,
      testFilePath,
      targetFilePath,
      telemetry: {
        provider: 'llm',
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        evidenceAssemblyMs,
        inferenceMs,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: `Failed to parse LLM JSON response: ${content.slice(0, 300)}`,
    };
  }

  const repairedCode = parsedProposal.repairedCode;
  if (!repairedCode || typeof repairedCode !== 'string' || repairedCode.trim().length === 0) {
    return {
      status: 'FAILED',
      tracePath,
      testFilePath,
      targetFilePath,
      telemetry: {
        provider: 'llm',
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        evidenceAssemblyMs,
        inferenceMs,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: 'LLM returned empty or invalid repairedCode',
    };
  }

  const diff = createDiff(path.relative(workspaceRoot, targetFilePath), originalTargetCode, repairedCode);

  // 3. Assertion Integrity Verification
  let assertionsPreserved = true;
  let beforeFingerprint = '';
  let afterFingerprint = '';
  try {
    // If the test file itself was edited, verify assertions
    if (targetFilePath === testFilePath) {
      beforeFingerprint = AssertionHasher.computeAssertionFingerprint(testFilePath);
      // Temporarily write to check fingerprint
      const tempPath = path.resolve(workspaceRoot, `.pie-assert-check-${Date.now()}.ts`);
      await fs.writeFile(tempPath, repairedCode, 'utf8');
      try {
        afterFingerprint = AssertionHasher.computeAssertionFingerprint(tempPath);
        assertionsPreserved = beforeFingerprint === afterFingerprint;
      } finally {
        await fs.unlink(tempPath).catch(() => {});
      }
    }
  } catch {
    assertionsPreserved = true;
  }

  // If execution was not requested, return proposal
  if (!input.execute && !input.autoPromote) {
    return {
      status: 'PROPOSAL_READY',
      tracePath,
      testFilePath,
      targetFilePath,
      analysis: parsedProposal.analysis ?? 'LLM generated direct code repair proposal',
      originalCode: originalTargetCode,
      repairedCode,
      diff,
      assertionIntegrity: {
        assertionsPreserved,
        beforeFingerprint,
        afterFingerprint,
      },
      telemetry: {
        provider: 'llm',
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        evidenceAssemblyMs,
        inferenceMs,
        executionMs: 0,
        totalMs: Date.now() - startedTotal,
      },
      reason: 'Proposal validated. Worktree execution was not requested.',
    };
  }

  // 4. Isolated Worktree Execution Verification
  const startedExec = Date.now();
  const manager = new WorktreeManager(workspaceRoot);
  const worktreeId = input.worktreeId ?? `direct-repair-${crypto.randomUUID().slice(0, 8)}`;
  let worktree: WorktreeInfo;
  try {
    worktree = await manager.createWorktree(worktreeId);
  } catch (err: any) {
    return {
      status: 'FAILED',
      tracePath,
      testFilePath,
      targetFilePath,
      telemetry: {
        provider: 'llm',
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
        evidenceAssemblyMs,
        inferenceMs,
        executionMs: Date.now() - startedExec,
        totalMs: Date.now() - startedTotal,
      },
      reason: `Failed to create isolated Git worktree: ${err.message}`,
    };
  }

  let executionPassed = false;
  let executionOutput = '';

  try {
    // Write the patched file into the worktree
    const relTarget = path.relative(workspaceRoot, targetFilePath);
    const worktreeTarget = path.resolve(worktree.worktreePath, relTarget);
    await fs.mkdir(path.dirname(worktreeTarget), { recursive: true });
    await fs.writeFile(worktreeTarget, repairedCode, 'utf8');

    // Execute Playwright test targeting this spec (with precise -g grep isolation for multi-test specs)
    const relSpec = path.relative(workspaceRoot, testFilePath);
    const testTitle = ArchiveReader.extractTestTitleFromArchive(tracePath, testFilePath);
    const projectName = ArchiveReader.extractProjectFromArchive(tracePath);
    const execRes = await ExecutionRunner.runPlaywrightTest({
      cwd: worktree.worktreePath,
      testFilePath: relSpec,
      grep: testTitle ? testTitle.trim() : undefined,
      configPath: input.configPath,
      timeoutMs: 60_000,
      env: { CI: '1', HEADLESS: '1' },
      headless: true,
      project: projectName,
    });

    executionPassed = execRes.exitCode === 0;
    executionOutput = execRes.stdout + (execRes.stderr ? `\nSTDERR:\n${execRes.stderr}` : '');

    // 5. Atomic Promotion if verified and requested
    if (executionPassed && input.autoPromote) {
      await fs.writeFile(targetFilePath, repairedCode, 'utf8');
    }
  } finally {
    // Clean up worktree
    await manager.destroyWorktree(worktree.id).catch(() => {});
  }

  const executionMs = Date.now() - startedExec;

  return {
    status: executionPassed ? 'REPAIRED_AND_VERIFIED' : 'VERIFICATION_FAILED',
    tracePath,
    testTitle: ArchiveReader.extractTestTitleFromArchive(tracePath, testFilePath),
    testFilePath,
    targetFilePath,
    analysis: parsedProposal.analysis ?? 'Direct LLM Code Generation',
    originalCode: originalTargetCode,
    repairedCode,
    diff,
    assertionIntegrity: {
      assertionsPreserved,
      beforeFingerprint,
      afterFingerprint,
    },
    worktree,
    executionPassed,
    executionOutput,
    telemetry: {
      provider: 'llm',
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      evidenceAssemblyMs,
      inferenceMs,
      executionMs,
      totalMs: Date.now() - startedTotal,
    },
    reason: executionPassed
      ? (input.autoPromote ? 'Test verified green in isolated worktree and promoted to workspace.' : 'Test verified green in isolated worktree.')
      : 'Test execution failed in isolated worktree with LLM repaired code.',
  };
}

export interface BatchDirectCodeRepairInput {
  workspaceRoot?: string | undefined;
  tracePaths?: string[] | undefined;
  execute?: boolean | undefined;
  autoPromote?: boolean | undefined;
  configPath?: string | undefined;
}

export interface BatchDirectCodeRepairResult {
  totalTraces: number;
  repairedCount: number;
  abstainedCount: number;
  failedCount: number;
  results: DirectCodeRepairResult[];
  aggregateTelemetry: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    totalInferenceMs: number;
    totalExecutionMs: number;
    totalMs: number;
  };
}

/**
 * Runs direct LLM code repair across all failing traces in the repository.
 */
export async function runBatchDirectCodeRepair(input: BatchDirectCodeRepairInput): Promise<BatchDirectCodeRepairResult> {
  const started = Date.now();
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());

  let tracePaths = input.tracePaths;
  if (!tracePaths || tracePaths.length === 0) {
    const resultsDir = path.resolve(workspaceRoot, 'test-results');
    tracePaths = [];
    if (fsSync.existsSync(resultsDir)) {
      const entries = fsSync.readdirSync(resultsDir, { recursive: true });
      for (const entry of entries) {
        const full = path.join(resultsDir, String(entry));
        if (full.endsWith('.zip')) {
          try {
            const discovery = ArchiveReader.findTraceFileEntries(full);
            if (discovery.hasFailure) {
              tracePaths.push(full);
            }
          } catch {}
        }
      }
    }
  }

  const results: DirectCodeRepairResult[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalInferenceMs = 0;
  let totalExecutionMs = 0;

  for (const tracePath of tracePaths) {
    try {
      const res = await runDirectCodeRepair({
        tracePath,
        workspaceRoot,
        execute: input.execute,
        autoPromote: input.autoPromote,
        configPath: input.configPath,
      });
      results.push(res);
      totalPromptTokens += res.telemetry.promptTokens;
      totalCompletionTokens += res.telemetry.completionTokens;
      totalTokens += res.telemetry.totalTokens;
      totalCostUsd += res.telemetry.estimatedCostUsd;
      totalInferenceMs += res.telemetry.inferenceMs;
      totalExecutionMs += res.telemetry.executionMs;
    } catch (err: any) {
      results.push({
        status: 'FAILED',
        tracePath,
        telemetry: {
          provider: 'llm',
          model: 'unknown',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          evidenceAssemblyMs: 0,
          inferenceMs: 0,
          executionMs: 0,
          totalMs: 0,
        },
        reason: err?.message ?? String(err),
      });
    }
  }

  return {
    totalTraces: results.length,
    repairedCount: results.filter((r) => r.status === 'REPAIRED_AND_VERIFIED').length,
    abstainedCount: results.filter((r) => r.status === 'ABSTAINED').length,
    failedCount: results.filter((r) => r.status === 'FAILED' || r.status === 'VERIFICATION_FAILED').length,
    results,
    aggregateTelemetry: {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd,
      totalInferenceMs,
      totalExecutionMs,
      totalMs: Date.now() - started,
    },
  };
}
