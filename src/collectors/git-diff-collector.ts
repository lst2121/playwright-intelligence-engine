import { execFileSync } from 'child_process';
import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';

export interface GitDiffInput {
  workspaceRoot: string;
  sinceRef?: string;
  executionId?: string;
}

export class GitDiffCollector implements EvidenceCollector<GitDiffInput> {
  public readonly name = 'GitDiffCollector';
  public readonly source = 'git-diff' as const;

  public async collect(input: GitDiffInput): Promise<UnifiedEvidenceRecord[]> {
    const executionId = input.executionId ?? `exec-${Date.now()}`;
    const timestamp = Date.now();
    const ref = input.sinceRef ?? 'HEAD~1';

    try {
      // 1. Get recent commits
      const logOutput = execFileSync(
        'git',
        ['log', '-n', '5', '--pretty=format:%h|%an|%s'],
        { cwd: input.workspaceRoot, encoding: 'utf-8', timeout: 5000 }
      );

      const recentCommits = logOutput
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, author, subject] = line.split('|');
          return { hash, author, subject };
        });

      // 2. Get changed files
      let changedFiles: string[] = [];
      try {
        const filesOutput = execFileSync('git', ['diff', '--name-only', ref, 'HEAD'], {
          cwd: input.workspaceRoot,
          encoding: 'utf-8',
          timeout: 5000,
        });
        changedFiles = filesOutput.split('\n').filter(Boolean);
      } catch {
        // If ref doesn't exist, diff working tree
        const uncommitted = execFileSync('git', ['diff', '--name-only'], {
          cwd: input.workspaceRoot,
          encoding: 'utf-8',
          timeout: 5000,
        });
        changedFiles = uncommitted.split('\n').filter(Boolean);
      }

      // 3. Get diff summary with line changes
      let rawDiff = '';
      try {
        rawDiff = execFileSync('git', ['diff', '-U2', ref, 'HEAD'], {
          cwd: input.workspaceRoot,
          encoding: 'utf-8',
          timeout: 5000,
          maxBuffer: 4 * 1024 * 1024,
        });
      } catch {
        rawDiff = execFileSync('git', ['diff', '-U2'], {
          cwd: input.workspaceRoot,
          encoding: 'utf-8',
          timeout: 5000,
          maxBuffer: 4 * 1024 * 1024,
        });
      }

      const { redactedText: cleanDiff } = EvidenceRedactor.redactText(rawDiff);

      // Extract modified selectors or identifiers in diff
      const modifiedAttributes: string[] = [];
      const attrMatches = cleanDiff.matchAll(/[+-]\s*.*?(id|data-testid|class|name|role|aria-label)=["']([^"']+)["']/g);
      for (const m of attrMatches) {
        modifiedAttributes.push(`${m[1]}="${m[2]}"`);
      }

      return [
        {
          evidenceId: `git-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          executionId,
          source: 'git-diff',
          timestamp,
          evidenceType: 'git-diff',
          payload: {
            sinceRef: ref,
            recentCommits,
            changedFiles,
            modifiedAttributes: Array.from(new Set(modifiedAttributes)),
            diffSnippet: cleanDiff.slice(0, 10000),
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: timestamp,
            captureMethod: 'git-cli-diff',
            sourceUri: input.workspaceRoot,
          },
          redactionStatus: { isRedacted: false },
        },
      ];
    } catch (err: any) {
      return [
        {
          evidenceId: `git-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          executionId,
          source: 'git-diff',
          timestamp,
          evidenceType: 'git-diff',
          payload: {
            error: err?.message || 'Failed to collect git diff',
            changedFiles: [],
            recentCommits: [],
          },
          reliability: 'LOW',
          provenance: {
            collector: this.name,
            collectedAt: timestamp,
            captureMethod: 'git-cli-diff',
            sourceUri: input.workspaceRoot,
          },
          redactionStatus: { isRedacted: false },
        },
      ];
    }
  }
}
