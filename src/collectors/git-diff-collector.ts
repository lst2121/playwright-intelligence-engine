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
      const attrMatches = cleanDiff.matchAll(/[+-]\s*.*?(id|data-testid|class|name|role|aria-label|placeholder)=["']([^"']+)["']/g);
      for (const m of attrMatches) {
        modifiedAttributes.push(`${m[1]}="${m[2]}"`);
      }

      const diffHints = GitDiffCollector.extractDiffHints(cleanDiff, changedFiles);

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
            diffHints,
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

  public static extractDiffHints(cleanDiff: string, changedFiles: string[]): {
    changedRoutes: string[];
    changedSymbols: string[];
    apiEndpoints: string[];
    validationHints: string[];
    existingTestsChanged: string[];
  } {
    const addedOrChangedLines = cleanDiff
      .split(/\r?\n/)
      .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
      .join('\n');

    const changedRoutes = new Set<string>();
    for (const file of changedFiles) {
      const appMatch = file.match(/(?:^|\/)(?:src\/)?app\/(.+?)\/page\.[tj]sx?$/i);
      if (appMatch?.[1]) changedRoutes.add(`/${appMatch[1]}`);
      const pagesMatch = file.match(/(?:^|\/)(?:src\/)?pages\/(.+?)\.[tj]sx?$/i);
      if (pagesMatch?.[1] && !pagesMatch[1].startsWith('api/')) {
        changedRoutes.add(pagesMatch[1] === 'index' ? '/' : `/${pagesMatch[1].replace(/\/index$/, '')}`);
      }
    }
    for (const m of addedOrChangedLines.matchAll(/path\s*[:=]\s*['"](\/[^'"]*)['"]/g)) {
      if (m[1]) changedRoutes.add(m[1]);
    }

    const changedSymbols = new Set<string>();
    for (const m of addedOrChangedLines.matchAll(/(?:function|class|const|export\s+(?:async\s+)?function)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (m[1]) changedSymbols.add(m[1]);
    }

    const apiEndpoints = new Set<string>();
    for (const m of addedOrChangedLines.matchAll(/['"`](\/api\/[A-Za-z0-9_/?=&{}:-]+)['"`]/g)) {
      if (m[1]) apiEndpoints.add(m[1]);
    }

    const validationHints = new Set<string>();
    for (const m of addedOrChangedLines.matchAll(/\.(min|max|email|regex|required)\s*\(([^)]*)\)/g)) {
      validationHints.add(`${m[1]}(${(m[2] ?? '').trim()})`);
    }
    for (const m of addedOrChangedLines.matchAll(/required(?:\s*=\s*\{?true\}?|\b)/g)) {
      validationHints.add(m[0].trim());
    }

    const existingTestsChanged = changedFiles.filter((f) => /\.(?:spec|test)\.[tj]sx?$/i.test(f));

    return {
      changedRoutes: [...changedRoutes],
      changedSymbols: [...changedSymbols].slice(0, 30),
      apiEndpoints: [...apiEndpoints].slice(0, 20),
      validationHints: [...validationHints].slice(0, 20),
      existingTestsChanged,
    };
  }
}

