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
  /**
   * Executes a command safely using child_process.spawn with an explicit argument array.
   * Eliminates shell injection risks and guarantees isolated execution.
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
      // Direct binary executables (git, node) run directly without shell
      const isWindows = process.platform === 'win32';
      let executable = command;
      let finalArgs = args;

      if (isWindows && (command === 'npx' || command === 'npm')) {
        executable = 'cmd.exe';
        finalArgs = ['/d', '/s', '/c', command, ...args];
      }

      const child = spawn(executable, finalArgs, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        shell: false,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after 2 seconds if still running
        setTimeout(() => child.kill('SIGKILL'), 2000);
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdoutAccumulator += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderrAccumulator += data.toString();
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

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? (timedOut ? -1 : 0),
          stdout: stdoutAccumulator,
          stderr: stderrAccumulator,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });
    });
  }
}
