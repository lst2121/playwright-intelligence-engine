import * as path from 'path';
import * as fs from 'fs';
import { WorktreeManager } from '../sandbox/worktree-manager.js';
import { ExecutionRunner } from '../sandbox/execution-runner.js';
import { ErrorCollector } from '../collectors/error-collector.js';
import { StaticAstCollector } from '../collectors/static-ast-collector.js';
import { GitDiffCollector } from '../collectors/git-diff-collector.js';
import { EnvironmentCollector } from '../collectors/environment-collector.js';
import { TraceCollector } from '../collectors/trace-collector.js';
import { EvidenceNormalizer } from '../evidence/evidence-normalizer.js';
import { EvidenceScorecard, UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';
import { DiagnosticContext } from '../core/types/diagnostic-context.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { DirectBrowserInvestigator } from './direct-browser-investigator.js';
import { LocatorPlan } from '../selector/candidate-extractor.js';
import { BrowserOperationExecutionResult } from '../repair/browser-operation-executor.js';

export interface DiagnosticRerunOptions {
  specFilePath: string;
  workspaceRoot: string;
  testNamePattern?: string;
  timeoutMs?: number;
  useWorktree?: boolean;
  enableLiveEscalation?: boolean;
  operation?: unknown;
  operationTargetPlan?: LocatorPlan | undefined;
  operationReplacementPlan?: LocatorPlan | undefined;
  operationOverlayPlan?: LocatorPlan | undefined;
  allowInteraction?: boolean | undefined;
}

export interface DiagnosticRerunResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  scorecard: EvidenceScorecard;
  unifiedEvidence: UnifiedEvidenceRecord[];
  context: DiagnosticContext;
  report: string;
  executedInWorktree: boolean;
  targetSpecPath: string;
  browserOperationResult?: BrowserOperationExecutionResult | undefined;
}

export class DiagnosticRerunner {
  /**
   * Mode A: Executes the failing Playwright test inside an isolated Git worktree (AUDIT-11 / B2).
   * Canonicalizes paths, guarantees worktree containment, captures multi-source evidence,
   * enforces central redaction, and escalates to live browser investigation if trace is absent.
   */
  public static async rerunAndDiagnose(options: DiagnosticRerunOptions): Promise<DiagnosticRerunResult> {
    const executionId = `rerun-${Date.now()}`;
    const worktreeManager = new WorktreeManager(options.workspaceRoot);
    let targetDir = options.workspaceRoot;
    let worktreeId: string | undefined;

    // 1. Resolve canonical workspace root (AUDIT-05)
    if (!fs.existsSync(options.workspaceRoot)) {
      throw new Error(`Workspace root does not exist: '${options.workspaceRoot}'`);
    }
    const canonicalWorkspace = fs.realpathSync(options.workspaceRoot);

    // 2. Fix absolute spec path bug (AUDIT-11 / B2): Calculate worktree-relative spec path
    let relativeSpec = options.specFilePath;
    if (path.isAbsolute(options.specFilePath)) {
      if (!fs.existsSync(options.specFilePath)) {
        throw new Error(`Spec file not found: '${options.specFilePath}'`);
      }
      const canonicalSpec = fs.realpathSync(options.specFilePath);
      const rel = path.relative(canonicalWorkspace, canonicalSpec);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `Security Violation: Spec file '${options.specFilePath}' escapes workspace root '${canonicalWorkspace}'.`
        );
      }
      relativeSpec = rel;
    }

    if (options.useWorktree !== false) {
      worktreeId = `reproduce-${Date.now().toString(36)}`;
      const info = await worktreeManager.createWorktree(worktreeId);
      targetDir = info.worktreePath;
    }

    try {
      const allRecords: UnifiedEvidenceRecord[] = [];
      const addRedacted = (records: UnifiedEvidenceRecord[]) => {
        for (const rec of records) {
          allRecords.push(EvidenceRedactor.redactRecord(rec));
        }
      };

      // 1. Environment Evidence
      const envCollector = new EnvironmentCollector();
      const envRecords = await envCollector.collect({
        workspaceRoot: targetDir,
        executionId,
      });
      addRedacted(envRecords);

      // 2. Git Diff Evidence
      const gitCollector = new GitDiffCollector();
      const gitRecords = await gitCollector.collect({
        workspaceRoot: targetDir,
        executionId,
      });
      addRedacted(gitRecords);

      // 3. Static AST Evidence of the failing spec strictly inside the worktree
      const worktreeTargetSpec = path.resolve(targetDir, relativeSpec);
      const astCollector = new StaticAstCollector();
      const astRecords = await astCollector.collect({
        targetFilePath: fs.existsSync(worktreeTargetSpec) ? worktreeTargetSpec : options.specFilePath,
        executionId,
      });
      addRedacted(astRecords);

      // 4. Execute Playwright test strictly targeting the worktree copy with --trace on (forward slashes for Windows regex matcher)
      const playwrightArgs = ['playwright', 'test', relativeSpec.replace(/\\/g, '/'), '--trace', 'on'];
      if (options.testNamePattern) {
        playwrightArgs.push('-g', options.testNamePattern);
      }

      const runStartTime = Date.now();
      const runResult = await ExecutionRunner.run('npx', {
        cwd: targetDir,
        args: playwrightArgs,
        timeoutMs: options.timeoutMs ?? 60000,
        env: {
          PW_INTELLIGENCE_REPRODUCE: '1',
          CI: '1',
        },
      });
      const passed = runResult.exitCode === 0;

      // 5. Ingest trace artifacts from test-results with freshness filtering (eliminates stale trace risk)
      let traceCaptured = false;
      const testResultsDir = path.join(targetDir, 'test-results');
      if (fs.existsSync(testResultsDir)) {
        const traceFiles = this.findTraceFiles(testResultsDir, runStartTime - 5000);
        if (traceFiles.length > 0 && traceFiles[0]) {
          const traceCollector = new TraceCollector();
          const traceRecords = await traceCollector.collect({
            archivePath: traceFiles[0],
            executionId,
          });
          addRedacted(traceRecords);
          traceCaptured = traceRecords.length > 0;
        }
      }

      // 6. Collect error evidence on failure
      if (!passed) {
        const errorCollector = new ErrorCollector();
        const errorRecords = await errorCollector.collect({
          errorMessage: runResult.stderr || runResult.stdout || 'Playwright test execution failed',
          errorStack: runResult.stderr,
          testFile: relativeSpec,
          executionId,
        });
        addRedacted(errorRecords);
      }

      // Check if trace records contain failure-point DOM snapshot (prevents Rule R-015 INCOMPLETE_EVIDENCE)
      const hasDomSnapshot = allRecords.some((r) => r.evidenceType === 'dom-snapshot');

      // Extract failing action selector if any from test output
      let failingSelector: string | undefined;
      let browserOperationResult: BrowserOperationExecutionResult | undefined;
      const selectorMatch = (runResult.stdout + '\n' + runResult.stderr).match(/locator\(['"]([^'"]+)['"]\)/);
      if (selectorMatch && selectorMatch[1]) {
        failingSelector = selectorMatch[1];
      }

      // 7. Tiered Escalation: If execution failed and (trace was absent OR trace lacked DOM snapshot), trigger Mode B DirectBrowserInvestigator
      if (!passed && (!traceCaptured || !hasDomSnapshot) && options.enableLiveEscalation !== false) {
        try {
          // Attempt to extract target URL from AST records or test stdout/stderr
          let discoveredUrl: string | undefined;
          const urlMatch = (runResult.stdout + '\n' + runResult.stderr).match(/https?:\/\/[^\s"'`)]+/);
          if (urlMatch && urlMatch[0]) {
            discoveredUrl = urlMatch[0];
          } else {
            // Check AST records for page.goto calls
            for (const rec of astRecords) {
              const strPayload = JSON.stringify(rec.payload ?? {});
              const astUrlMatch = strPayload.match(/https?:\/\/[^\s"'`)]+/);
              if (astUrlMatch && astUrlMatch[0]) {
                discoveredUrl = astUrlMatch[0];
                break;
              }
            }
          }

          if (discoveredUrl) {
            const directRes = await DirectBrowserInvestigator.investigateUrl({
              url: discoveredUrl,
              actionSelector: failingSelector,
              intendedAction: 'click',
              executionId,
              timeoutMs: 10000,
              operation: options.operation,
              operationTargetPlan: options.operationTargetPlan,
              operationReplacementPlan: options.operationReplacementPlan,
              operationOverlayPlan: options.operationOverlayPlan,
              allowInteraction: options.allowInteraction,
            });
            browserOperationResult = directRes.browserOperationResult;

            // AUDIT FIX: Only accept live browser evidence if action genuinely failed (REPRODUCED) or captured failure DOM
            if (directRes.success && (directRes.status === 'REPRODUCED' || directRes.domSnapshotRecord)) {
              if (directRes.domSnapshotRecord) {
                addRedacted([directRes.domSnapshotRecord]);
              }
              if (directRes.ariaSnapshotRecord) {
                addRedacted([directRes.ariaSnapshotRecord]);
              }
              if (directRes.status === 'REPRODUCED' && directRes.records.length > 0) {
                addRedacted(directRes.records);
              }
            }
          }
        } catch {
          // Graceful fallback if headless chromium cannot launch
        }
      }

      // 8. Normalize multi-source evidence to DiagnosticContext
      const context = EvidenceNormalizer.toDiagnosticContext(allRecords);
      const scorecard = EvidenceNormalizer.calculateScorecard(allRecords);

      // 9. Correlate and generate report
      const correlated = EvidenceCorrelator.correlate(context);
      const report = DiagnosticReportGenerator.generateTerminalReport(correlated, scorecard);

      return {
        passed,
        exitCode: runResult.exitCode,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        scorecard,
        unifiedEvidence: allRecords,
        context,
        report,
        executedInWorktree: options.useWorktree !== false,
        targetSpecPath: worktreeTargetSpec,
        browserOperationResult,
      };
    } finally {
      if (worktreeId) {
        await worktreeManager.destroyWorktree(worktreeId).catch(() => {});
      }
    }
  }

  private static findTraceFiles(dir: string, minMtimeMs?: number): string[] {
    const results: Array<{ filePath: string; mtimeMs: number }> = [];
    const scan = (currentDir: string) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('trace.zip')) {
            try {
              const stat = fs.statSync(fullPath);
              if (!minMtimeMs || stat.mtimeMs >= minMtimeMs) {
                results.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
              }
            } catch {
              results.push({ filePath: fullPath, mtimeMs: 0 });
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    };
    scan(dir);
    // Sort descending by modification time (freshest trace first)
    return results.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => r.filePath);
  }
}
