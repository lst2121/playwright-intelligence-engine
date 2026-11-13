import { execFileSync } from 'node:child_process';

/**
 * Product identity is kept in one place so the CLI, MCP server, and execution
 * proofs cannot silently advertise different versions.
 */
export const PACKAGE_VERSION = '2.0.0';
export const ENGINE_MILESTONE = '2.0.0';
export const PROOF_VERSION = ENGINE_MILESTONE;

export interface RuntimeProvenance {
  sourceRevision: string;
  workspaceDirty: boolean;
}

export function getRuntimeProvenance(root = process.cwd()): RuntimeProvenance {
  try {
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { sourceRevision, workspaceDirty: status.trim().length > 0 };
  } catch {
    return { sourceRevision: 'unknown', workspaceDirty: false };
  }
}

