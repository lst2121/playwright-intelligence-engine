import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { RepositoryManifest } from './repository-inspector.js';

export interface RepositoryRunOptions {
  script?: string | undefined;
  timeoutMs?: number | undefined;
  environment?: Record<string, string> | undefined;
}

export interface RepositoryRunResult {
  repository: string;
  command: string;
  args: string[];
  cwd: string;
  status: 'PASS' | 'FAIL' | 'TIMEOUT' | 'BLOCKED';
  exitCode: number | null;
  signal?: string | undefined;
  stdout: string;
  stderr: string;
  durationMs: number;
  reason?: string | undefined;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SAFE_COMMANDS = new Set(['npm', 'pnpm', 'yarn', 'npx']);

function executableFor(manager: RepositoryManifest['packageManager']): string {
  if (manager === 'pnpm') return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  if (manager === 'yarn') return process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function chooseScript(manifest: RepositoryManifest, requested?: string): string | undefined {
  if (requested) return requested;
  const candidates = ['test:e2e', 'test:smoke', 'test', 'pw:ui'];
  return candidates.find((candidate) => manifest.scripts[candidate]);
}

export class RepositoryRunner {
  public static async runBaseline(manifest: RepositoryManifest, options: RepositoryRunOptions = {}): Promise<RepositoryRunResult> {
    if (manifest.status !== 'DISCOVERED') {
      return {
        repository: manifest.name,
        command: '',
        args: [],
        cwd: manifest.root,
        status: 'BLOCKED',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        reason: `Repository status is ${manifest.status}`,
      };
    }

    const script = chooseScript(manifest, options.script);
    const executable = executableFor(manifest.packageManager);
    const args = script ? ['run', script] : ['exec', 'playwright', 'test'];
    return this.runCommand(manifest, executable, args, options);
  }

  public static runCommand(
    manifest: RepositoryManifest,
    executable: string,
    args: string[],
    options: RepositoryRunOptions = {},
  ): Promise<RepositoryRunResult> {
    const normalizedExecutable = path.basename(executable).replace(/\.cmd$/i, '').toLowerCase();
    if (!SAFE_COMMANDS.has(normalizedExecutable)) {
      return Promise.resolve({
        repository: manifest.name,
        command: executable,
        args,
        cwd: manifest.root,
        status: 'BLOCKED',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        reason: `Command '${executable}' is not in the repository evaluation allowlist`,
      });
    }

    if (args.some((argument) => /[&|<>]/.test(argument))) {
      return Promise.resolve({
        repository: manifest.name,
        command: executable,
        args,
        cwd: manifest.root,
        status: 'BLOCKED',
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        reason: 'Command arguments contain shell metacharacters',
      });
    }

    const isWindows = process.platform === 'win32';
    const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : executable;
    const spawnArgs = isWindows
      ? ['/d', '/s', '/c', [executable, ...args].map((argument) => argument.includes(' ') ? `"${argument.replace(/"/g, '\\"')}"` : argument).join(' ')]
      : args;

    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(command, spawnArgs, {
        cwd: manifest.root,
        shell: false,
        windowsHide: true,
        env: { ...process.env, CI: 'true', ...options.environment },
      });
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: RepositoryRunResult): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      };
      const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >= MAX_OUTPUT_BYTES) {
          truncated = true;
          return;
        }
        if (target === 'stdout') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      };
      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));

      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        if (process.platform === 'win32' && child.pid) {
          spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            shell: false,
            timeout: 5_000,
          });
          child.stdout?.destroy();
          child.stderr?.destroy();
        }
        finish({
          repository: manifest.name,
          command: executable,
          args,
          cwd: manifest.root,
          status: 'TIMEOUT',
          exitCode: null,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          reason: 'Command exceeded the configured timeout',
        });
      }, options.timeoutMs ?? 15 * 60 * 1000);

      child.on('error', (error) => {
        finish({
          repository: manifest.name,
          command: executable,
          args,
          cwd: manifest.root,
          status: 'BLOCKED',
          exitCode: null,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          reason: `Unable to start command: ${error.message}`,
        });
      });

      child.on('close', (exitCode, signal) => {
        finish({
          repository: manifest.name,
          command: executable,
          args,
          cwd: manifest.root,
          status: timedOut ? 'TIMEOUT' : exitCode === 0 ? 'PASS' : 'FAIL',
          exitCode,
          signal: signal ?? undefined,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          reason: truncated ? 'Output truncated at 16 MB' : undefined,
        });
      });
    });
  }
}

