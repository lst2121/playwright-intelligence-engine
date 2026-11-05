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
import { DiagnosticContext } from '../core/types/diagnostic-context.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';

export interface DiagnosticRerunOptions {
  specFilePath: string;
  workspaceRoot: string;
  testNamePattern?: string;
  timeoutMs?: number;
  useWorktree?: boolean;
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
}

export class DiagnosticRerunner {
  public static async rerunAndDiagnose(options: DiagnosticRerunOptions): Promise<DiagnosticRerunResult> {
    const executionId = `rerun-${Date.now()}`;
    const worktreeManager = new WorktreeManager(options.workspaceRoot);
    let targetDir = options.workspaceRoot;
    let worktreeId: string | undefined;

    if (options.useWorktree !== false) {
      worktreeId = `reproduce-${Date.now().toString(36)}`;
      const info = await worktreeManager.createWorktree(worktreeId);
      targetDir = info.worktreePath;
    }

    try {
      const allRecords: UnifiedEvidenceRecord[] = [];

      // 1. Environment Evidence
      const envCollector = new EnvironmentCollector();
      const envRecords = await envCollector.collect({
        workspaceRoot: targetDir,
        executionId,
      });
      allRecords.push(...envRecords);

      // 2. Git Diff Evidence
      const gitCollector = new GitDiffCollector();
      const gitRecords = await gitCollector.collect({
        workspaceRoot: targetDir,
        executionId,
      });
      allRecords.push(...gitRecords);

      // 3. Static AST Evidence of the failing spec
      const targetSpec = path.isAbsolute(options.specFilePath)
        ? options.specFilePath
        : path.join(targetDir, options.specFilePath);

      const astCollector = new StaticAstCollector();
      const astRecords = await astCollector.collect({
        targetFilePath: targetSpec,
        executionId,
      });
      allRecords.push(...astRecords);

      // 4. Execute Playwright test
      const runResult = await ExecutionRunner.run('npx', {
        cwd: targetDir,
        args: ['playwright', 'test', options.specFilePath],
        timeoutMs: options.timeoutMs ?? 60000,
        env: {
          PW_INTELLIGENCE_REPRODUCE: '1',
          CI: '1',
        },
      });
      const passed = runResult.exitCode === 0;

      // 5. Check for test artifacts / traces in test-results directory
      const testResultsDir = path.join(targetDir, 'test-results');
      if (fs.existsSync(testResultsDir)) {
        const traceFiles = this.findTraceFiles(testResultsDir);
        if (traceFiles.length > 0 && traceFiles[0]) {
          const traceCollector = new TraceCollector();
          const traceRecords = await traceCollector.collect({
            archivePath: traceFiles[0],
            executionId,
          });
          allRecords.push(...traceRecords);
        }
      }

      // 6. If execution failed, collect error evidence
      if (!passed) {
        const errorCollector = new ErrorCollector();
        const errorRecords = await errorCollector.collect({
          errorMessage: runResult.stderr || runResult.stdout || 'Playwright test execution failed',
          errorStack: runResult.stderr,
          testFile: options.specFilePath,
          executionId,
        });
        allRecords.push(...errorRecords);
      }

      // 7. Normalize multi-source evidence to DiagnosticContext
      const context = EvidenceNormalizer.toDiagnosticContext(allRecords);
      const scorecard = EvidenceNormalizer.calculateScorecard(allRecords);

      // 8. Correlate and generate report
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
      };
    } finally {
      if (worktreeId) {
        await worktreeManager.destroyWorktree(worktreeId).catch(() => {});
      }
    }
  }

  private static findTraceFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findTraceFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('trace.zip')) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore directory read errors
    }
    return results;
  }
}
