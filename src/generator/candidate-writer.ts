import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CandidateChange, CandidateFile } from '../authoring/author.js';
import { isSafeRelativeProposalPath, normalizeProposalPath } from '../authoring/generation-contract.js';

export interface FileSnapshot {
  relativePath: string;
  existed: boolean;
  sha256Before?: string | undefined;
  contentBefore?: string | undefined;
}

export interface CandidateWriteOptions {
  protectedPaths?: string[] | undefined;
  allowModify?: boolean | undefined;
  overwriteCreate?: boolean | undefined;
  validateLocalImports?: boolean | undefined;
}

export interface CandidateWriteResult {
  success: boolean;
  written: string[];
  modified: string[];
  skipped: string[];
  snapshots: FileSnapshot[];
  errors: string[];
}

const DEFAULT_PROTECTED_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  '.env',
  '.env.local',
  '.env.test',
]);

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function isProtectedPath(normPath: string, extraProtected: Set<string>): boolean {
  if (DEFAULT_PROTECTED_PATHS.has(normPath) || extraProtected.has(normPath)) return true;
  if (normPath.startsWith('.git/') || normPath === '.git') return true;
  if (normPath.startsWith('node_modules/') || normPath === 'node_modules') return true;
  if (path.posix.basename(normPath).startsWith('.env')) return true;
  return false;
}

async function assertNoSymlinkEscape(canonicalRoot: string, workspaceRoot: string, normPath: string): Promise<string> {
  const target = path.resolve(workspaceRoot, normPath);
  const relativeFromRoot = path.relative(workspaceRoot, target);
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Path escapes workspace root: '${normPath}'`);
  }

  // Walk existing path segments to reject symlinks / junctions pointing outside workspaceRoot
  const segments = normPath.split('/');
  let current = workspaceRoot;
  for (let i = 0; i < segments.length; i += 1) {
    current = path.join(current, segments[i]!);
    try {
      const lstat = await fs.lstat(current);
      if (lstat.isSymbolicLink()) {
        const real = await fs.realpath(current);
        const relReal = path.relative(canonicalRoot, real);
        if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
          throw new Error(`Symlink escapes workspace root at '${current}' -> '${real}'`);
        }
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }

  // Check nearest existing parent directory realpath
  let parent = path.dirname(target);
  while (parent && parent !== path.dirname(parent)) {
    if (fsSync.existsSync(parent)) {
      const realParent = fsSync.realpathSync(parent);
      const rel = path.relative(canonicalRoot, realParent);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Resolved parent directory escapes workspace root: '${realParent}'`);
      }
      break;
    }
    parent = path.dirname(parent);
  }

  return target;
}

function validateRelativeImports(files: CandidateFile[], workspaceRoot: string): string[] {
  const errors: string[] = [];
  const candidatePathSet = new Set(files.map((f) => normalizeProposalPath(f.relativePath)));

  for (const file of files) {
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(file.relativePath)) continue;
    const fromDir = path.posix.dirname(normalizeProposalPath(file.relativePath));
    const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[^'"`]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;
    for (const match of file.content.matchAll(importRegex)) {
      const specifier = match[1]!;
      const joined = normalizeProposalPath(path.posix.join(fromDir === '.' ? '' : fromDir, specifier));
      const strippedExt = joined.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx)$/, '');
      const candidates = [
        joined,
        `${joined}.ts`,
        `${joined}.tsx`,
        `${joined}.js`,
        `${strippedExt}.ts`,
        `${strippedExt}.tsx`,
        `${strippedExt}/index.ts`,
        `${strippedExt}/index.tsx`,
      ];
      const foundInCandidate = candidates.some((c) => candidatePathSet.has(c));
      const foundOnDisk = candidates.some((c) => fsSync.existsSync(path.resolve(workspaceRoot, c)));
      if (!foundInCandidate && !foundOnDisk) {
        errors.push(`Unresolved local import '${specifier}' in '${file.relativePath}'`);
      }
    }
  }
  return errors;
}

export class CandidateWriter {
  /**
   * Transactionally validates and applies CandidateChange files to workspaceRoot.
   * Performs path safety, symlink checks, duplicate checks, CREATE/MODIFY checks,
   * snapshot capture, and full rollback if any file write fails.
   */
  public static async apply(
    workspaceRoot: string,
    candidate: Pick<CandidateChange, 'files'>,
    options: CandidateWriteOptions = {},
  ): Promise<CandidateWriteResult> {
    const resolvedRoot = path.resolve(workspaceRoot);
    await fs.mkdir(resolvedRoot, { recursive: true });
    const canonicalRoot = fsSync.realpathSync(resolvedRoot);
    const extraProtected = new Set<string>((options.protectedPaths ?? []).map(normalizeProposalPath));

    const errors: string[] = [];
    const seen = new Set<string>();
    const prepared: Array<{ file: CandidateFile; normPath: string; target: string; action: 'CREATE' | 'MODIFY' | 'SKIP_EXISTING' }> = [];

    for (const file of candidate.files) {
      if (!isSafeRelativeProposalPath(file.relativePath)) {
        errors.push(`Unsafe candidate path rejected: '${file.relativePath}'`);
        continue;
      }
      const normPath = normalizeProposalPath(file.relativePath);
      if (seen.has(normPath)) {
        errors.push(`Duplicate candidate path rejected: '${normPath}'`);
        continue;
      }
      seen.add(normPath);

      if (isProtectedPath(normPath, extraProtected)) {
        errors.push(`Protected path cannot be modified: '${normPath}'`);
        continue;
      }

      let target: string;
      try {
        target = await assertNoSymlinkEscape(canonicalRoot, resolvedRoot, normPath);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        continue;
      }

      const action = file.action ?? 'CREATE';
      const existsOnDisk = fsSync.existsSync(target);

      if (action === 'SKIP_EXISTING') {
        prepared.push({ file, normPath, target, action: 'SKIP_EXISTING' });
        continue;
      }

      if (action === 'MODIFY') {
        if (options.allowModify === false) {
          errors.push(`MODIFY action disallowed by policy for '${normPath}'`);
          continue;
        }
        if (!existsOnDisk) {
          errors.push(`Cannot MODIFY non-existent file '${normPath}'`);
          continue;
        }
      } else if (action === 'CREATE' && existsOnDisk && !options.overwriteCreate) {
        prepared.push({ file, normPath, target, action: 'SKIP_EXISTING' });
        continue;
      }

      prepared.push({ file, normPath, target, action });
    }

    if (options.validateLocalImports) {
      errors.push(...validateRelativeImports(candidate.files, resolvedRoot));
    }

    if (errors.length > 0) {
      return {
        success: false,
        written: [],
        modified: [],
        skipped: [],
        snapshots: [],
        errors,
      };
    }

    const snapshots: FileSnapshot[] = [];
    const written: string[] = [];
    const modified: string[] = [];
    const skipped: string[] = [];

    try {
      for (const item of prepared) {
        if (item.action === 'SKIP_EXISTING') {
          skipped.push(item.normPath);
          continue;
        }

        const existed = fsSync.existsSync(item.target);
        if (existed) {
          const prior = await fs.readFile(item.target, 'utf8');
          snapshots.push({
            relativePath: item.normPath,
            existed: true,
            sha256Before: sha256(prior),
            contentBefore: prior,
          });
        } else {
          snapshots.push({ relativePath: item.normPath, existed: false });
        }

        await fs.mkdir(path.dirname(item.target), { recursive: true });
        await fs.writeFile(item.target, item.file.content, 'utf8');
        if (item.action === 'MODIFY') modified.push(item.normPath);
        else written.push(item.normPath);
      }

      return {
        success: true,
        written,
        modified,
        skipped,
        snapshots,
        errors: [],
      };
    } catch (error) {
      await CandidateWriter.rollback(resolvedRoot, snapshots);
      return {
        success: false,
        written: [],
        modified: [],
        skipped,
        snapshots,
        errors: [`Transactional write failed and rolled back: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * Restores all files modified during a CandidateWriter transaction and removes newly created files.
   */
  public static async rollback(workspaceRoot: string, snapshots: FileSnapshot[]): Promise<void> {
    const resolvedRoot = path.resolve(workspaceRoot);
    for (let i = snapshots.length - 1; i >= 0; i -= 1) {
      const snap = snapshots[i]!;
      const target = path.resolve(resolvedRoot, snap.relativePath);
      try {
        if (snap.existed && snap.contentBefore !== undefined) {
          await fs.writeFile(target, snap.contentBefore, 'utf8');
        } else if (!snap.existed) {
          await fs.rm(target, { force: true });
        }
      } catch {
        // Best-effort rollback continuation
      }
    }
  }
}
