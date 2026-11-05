import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';

export interface EnvironmentInput {
  workspaceRoot?: string;
  executionId?: string;
}

export class EnvironmentCollector implements EvidenceCollector<EnvironmentInput> {
  public readonly name = 'EnvironmentCollector';
  public readonly source = 'environment' as const;

  public async collect(input: EnvironmentInput = {}): Promise<UnifiedEvidenceRecord[]> {
    const executionId = input.executionId ?? `exec-${Date.now()}`;
    const timestamp = Date.now();

    // 1. Playwright version detection
    let playwrightVersion = 'unknown';
    if (input.workspaceRoot) {
      try {
        const pwPkgPath = path.join(
          input.workspaceRoot,
          'node_modules',
          '@playwright',
          'test',
          'package.json'
        );
        if (fs.existsSync(pwPkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pwPkgPath, 'utf-8'));
          playwrightVersion = pkg.version || 'unknown';
        } else {
          // Check root package.json
          const rootPkgPath = path.join(input.workspaceRoot, 'package.json');
          if (fs.existsSync(rootPkgPath)) {
            const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
            playwrightVersion =
              rootPkg.devDependencies?.['@playwright/test'] ||
              rootPkg.dependencies?.['@playwright/test'] ||
              'unknown';
          }
        }
      } catch {
        // Safe fallback
      }
    }

    // 2. Identify CI Provider safely (zero secret leakage)
    let ciProvider: string | null = null;
    let ciRunId: string | null = null;
    if (process.env.GITHUB_ACTIONS) {
      ciProvider = 'GitHub Actions';
      ciRunId = process.env.GITHUB_RUN_ID ?? null;
    } else if (process.env.GITLAB_CI) {
      ciProvider = 'GitLab CI';
      ciRunId = process.env.CI_PIPELINE_ID ?? null;
    } else if (process.env.JENKINS_URL) {
      ciProvider = 'Jenkins';
      ciRunId = process.env.BUILD_NUMBER ?? null;
    } else if (process.env.CIRCLECI) {
      ciProvider = 'CircleCI';
      ciRunId = process.env.CIRCLE_BUILD_NUM ?? null;
    } else if (process.env.TF_BUILD) {
      ciProvider = 'Azure DevOps Pipelines';
      ciRunId = process.env.BUILD_BUILDID ?? null;
    }

    const payload = {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      cpuCount: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
      playwrightVersion,
      ciProvider,
      ciRunId,
      isCI: Boolean(process.env.CI),
    };

    return [
      {
        evidenceId: `env-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        executionId,
        source: 'environment',
        timestamp,
        evidenceType: 'environment-metadata',
        payload,
        reliability: 'HIGH',
        provenance: {
          collector: this.name,
          collectedAt: timestamp,
          captureMethod: 'os-process-inspection',
        },
        redactionStatus: { isRedacted: false },
      },
    ];
  }
}

