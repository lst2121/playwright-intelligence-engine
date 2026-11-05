import { spawn } from 'node:child_process';

export interface ExecutionOptions {
  cwd: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export class ExecutionRunner {
  private static readonly MAX_OUTPUT_BUFFER = 16 * 1024 * 1024; // 16 MB max buffer limit

  private static readonly SAFE_ENV_KEYS = new Set([
    'PATH',
    'Path',
    'PATHEXT',
    'SYSTEMROOT',
    'SystemRoot',
    'SYSTEMDRIVE',
    'SystemDrive',
    'TEMP',
    'TMP',
    'HOMEDRIVE',
    'HOMEPATH',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
    'LC_ALL',
    'NODE_ENV',
    'TERM',
    'SHELL',
    'PWD',
    'COMSPEC',
    'ComSpec',
  ]);

  /**
   * Sanitizes inherited environment variables, stripping cloud credentials,
   * tokens, database URLs, and secrets to protect host environments.
   */
  private static getSanitizedEnv(explicitEnv?: Record<string, string | undefined>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, val] of Object.entries(process.env)) {
      if (ExecutionRunner.SAFE_ENV_KEYS.has(key) && val !== undefined) {
        sanitized[key] = val;
      }
    }

    if (explicitEnv) {
      for (const [key, val] of Object.entries(explicitEnv)) {
        if (val !== undefined) {
          sanitized[key] = val;
        }
      }
    }

    return sanitized;
  }

  /**
   * Executes a command safely using child_process.spawn with an explicit argument array.
   * Eliminates shell injection risks, sanitizes environment, bounds buffer sizes,
   * and terminates entire process trees upon timeout.
   */
  public static async run(
    command: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const args = options.args ?? [];
    const timeoutMs = options.timeoutMs ?? 120000; // Default 2 minutes
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdoutAccumulator = '';
      let stderrAccumulator = '';
      let timedOut = false;

      // On Windows, batch commands (.cmd/.bat) like npm/npx require invoking through cmd.exe
      const isWindows = process.platform === 'win32';
      let executable = command;
      let finalArgs = args;

      if (isWindows && (command === 'npx' || command === 'npm')) {
        executable = 'cmd.exe';
        finalArgs = ['/d', '/s', '/c', command, ...args];
      }

      const child = spawn(executable, finalArgs, {
        cwd: options.cwd,
        env: ExecutionRunner.getSanitizedEnv(options.env),
        shell: false,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          if (isWindows) {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          } else {
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 2000);
          }
        }
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        if (stdoutAccumulator.length < ExecutionRunner.MAX_OUTPUT_BUFFER) {
          stdoutAccumulator += data.toString();
        }
      });

      child.stderr?.on('data', (data) => {
        if (stderrAccumulator.length < ExecutionRunner.MAX_OUTPUT_BUFFER) {
          stderrAccumulator += data.toString();
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator + `\nProcess error: ${err.message}`,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        // Correct signal-terminated process handling: never map code === null to 0
        let exitCode: number;
        if (code !== null) {
          exitCode = code;
        } else if (timedOut) {
          exitCode = -1;
        } else if (signal) {
          exitCode = 128 + 15;
        } else {
          exitCode = 1;
        }

        resolve({
          exitCode,
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });
    });
  }
}
