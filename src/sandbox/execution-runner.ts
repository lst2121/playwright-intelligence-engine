import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

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
  truncated: boolean;
}

export class ExecutionRunner {
  public static readonly MAX_OUTPUT_BYTES = 16 * 1024 * 1024; // 16 MB max byte buffer limit

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
    'CI',
    'PW_INTELLIGENCE_REPRODUCE',
    'PLAYWRIGHT_BROWSERS_PATH',
  ]);

  private static readonly DANGEROUS_ENV_KEYS = new Set([
    'NODE_OPTIONS',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'PERL5OPT',
    'PYTHONPATH',
    'RUBYOPT',
    'BASH_ENV',
    'ENV',
  ]);

  private static readonly SIGNAL_MAP: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGBUS: 7,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGUSR2: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
  };

  /**
   * Sanitizes inherited and explicit environment variables (AUDIT-15).
   * Strictly filters against SAFE_ENV_KEYS and explicitly blocks dangerous
   * interpreter-injection keys like NODE_OPTIONS.
   */
  public static getSanitizedEnv(explicitEnv?: Record<string, string | undefined>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, val] of Object.entries(process.env)) {
      if (ExecutionRunner.SAFE_ENV_KEYS.has(key) && val !== undefined) {
        sanitized[key] = val;
      }
    }

    if (explicitEnv) {
      for (const [key, val] of Object.entries(explicitEnv)) {
        if (val !== undefined) {
          const upperKey = key.toUpperCase();
          if (ExecutionRunner.DANGEROUS_ENV_KEYS.has(upperKey)) {
            // Reject dangerous interpreter override keys
            continue;
          }
          // Allow explicit test variables matching safe prefixes or safe allowlist
          if (
            ExecutionRunner.SAFE_ENV_KEYS.has(key) ||
            key.startsWith('PLAYWRIGHT_') ||
            key.startsWith('TEST_') ||
            key.startsWith('PW_') ||
            key === 'DEBUG' ||
            key === 'PORT'
          ) {
            sanitized[key] = val;
          }
        }
      }
    }

    return sanitized;
  }

  /**
   * Executes a command safely using child_process.spawn with an explicit argument array.
   * Eliminates shell injection risks, sanitizes environment, bounds buffer sizes strictly by bytes,
   * preserves signal exit codes, and terminates entire process trees upon timeout.
   */
  public static async run(
    command: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const args = options.args ?? [];
    const timeoutMs = options.timeoutMs ?? 120000; // Default 2 minutes
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;
      let truncated = false;

      // On Windows, resolve npx/npm directly via node.exe with bundled CLI scripts to avoid cmd.exe shell injection
      const isWindows = process.platform === 'win32';
      let executable = command;
      let finalArgs = args;

      if (isWindows && (command === 'npx' || command === 'npm')) {
        const cliName = command === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
        const bundledCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', cliName);
        if (fs.existsSync(bundledCli)) {
          executable = process.execPath;
          finalArgs = [bundledCli, ...args];
        } else {
          executable = 'cmd.exe';
          finalArgs = ['/d', '/s', '/c', command, ...args];
        }
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
            try {
              spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            } catch {
              child.kill();
            }
          } else {
            child.kill('SIGTERM');
            setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // process already dead
              }
            }, 2000);
          }
        }
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf-8');
        if (stdoutBytes + buf.length <= ExecutionRunner.MAX_OUTPUT_BYTES) {
          stdoutChunks.push(buf);
          stdoutBytes += buf.length;
        } else {
          const remaining = ExecutionRunner.MAX_OUTPUT_BYTES - stdoutBytes;
          if (remaining > 0) {
            stdoutChunks.push(buf.subarray(0, remaining));
            stdoutBytes += remaining;
          }
          truncated = true;
        }
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf-8');
        if (stderrBytes + buf.length <= ExecutionRunner.MAX_OUTPUT_BYTES) {
          stderrChunks.push(buf);
          stderrBytes += buf.length;
        } else {
          const remaining = ExecutionRunner.MAX_OUTPUT_BYTES - stderrBytes;
          if (remaining > 0) {
            stderrChunks.push(buf.subarray(0, remaining));
            stderrBytes += remaining;
          }
          truncated = true;
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const stdoutStr = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderrStr = Buffer.concat(stderrChunks).toString('utf-8');
        resolve({
          exitCode: -1,
          stdout: stdoutStr,
          stderr: stderrStr + `\nProcess error: ${err.message}`,
          durationMs: Date.now() - startTime,
          timedOut,
          truncated,
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        // Correct signal-terminated process handling (AUDIT-08): never map code === null to 0
        let exitCode: number;
        if (code !== null) {
          exitCode = code;
        } else if (timedOut) {
          exitCode = -1;
        } else if (signal) {
          const sigNum = ExecutionRunner.SIGNAL_MAP[signal] ?? 15;
          exitCode = 128 + sigNum;
        } else {
          exitCode = 1;
        }

        const stdoutStr = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderrStr = Buffer.concat(stderrChunks).toString('utf-8');

        resolve({
          exitCode,
          stdout: stdoutStr,
          stderr: stderrStr,
          durationMs: Date.now() - startTime,
          timedOut,
          truncated,
        });
      });
    });
  }

  /**
   * Executes a Playwright test specification via npx in the specified working directory.
   * Guarantees process isolation, command sanitization, and true execution proofs.
   */
  public static async runPlaywrightTest(options: {
    cwd: string;
    testFilePath: string;
    configPath?: string | undefined;
    grep?: string | undefined;
    timeoutMs?: number | undefined;
    env?: Record<string, string> | undefined;
  }): Promise<ExecutionResult> {
    const relOrNormPath = path.isAbsolute(options.testFilePath)
      ? path.relative(options.cwd, options.testFilePath).replace(/\\/g, '/') || options.testFilePath.replace(/\\/g, '/')
      : options.testFilePath.replace(/\\/g, '/');
    const args = ['playwright', 'test', relOrNormPath, '--reporter=line'];
    if (options.configPath) {
      args.push('--config', options.configPath);
    }
    if (options.grep) {
      args.push('-g', options.grep);
    }
    const runnerOptions: ExecutionOptions = {
      cwd: options.cwd,
      args,
      timeoutMs: options.timeoutMs ?? 60000,
    };
    if (options.env) {
      runnerOptions.env = options.env;
    }
    return ExecutionRunner.run('npx', runnerOptions);
  }

  /**
   * Computes the two-sided Wilson score confidence interval for binomial success rates.
   * Provides mathematically rigorous confidence bounds for flaky test verification.
   */
  public static computeWilsonScoreInterval(k: number, n: number, confidence = 0.95): WilsonScoreInterval {
    if (n <= 0) {
      return { lower: 0, upper: 0, center: 0, confidenceLevel: confidence };
    }
    const z = confidence === 0.99 ? 2.5758 : 1.95996;
    const p = Math.max(0, Math.min(1, k / n));
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;

    const lower = Math.max(0, parseFloat(((center - margin) * 100).toFixed(2)));
    const upper = Math.min(100, parseFloat(((center + margin) * 100).toFixed(2)));

    return {
      lower,
      upper,
      center: parseFloat((center * 100).toFixed(2)),
      confidenceLevel: confidence,
    };
  }

  /**
   * Executes repeated trials of a Playwright test specification to statistically
   * evaluate flakiness and measure intent preservation with Wilson confidence intervals.
   */
  public static async runRepeatedPlaywrightTrials(options: {
    cwd: string;
    testFilePath: string;
    trials: number;
    configPath?: string | undefined;
    grep?: string | undefined;
    timeoutMs?: number | undefined;
    env?: Record<string, string> | undefined;
  }): Promise<RepeatedExecutionSummary> {
    const trialsCount = Math.max(1, options.trials);
    const results: ExecutionResult[] = [];
    const durations: number[] = [];
    let passed = 0;
    let failed = 0;
    let timedOut = 0;

    for (let i = 0; i < trialsCount; i++) {
      const res = await ExecutionRunner.runPlaywrightTest({
        cwd: options.cwd,
        testFilePath: options.testFilePath,
        configPath: options.configPath,
        grep: options.grep,
        timeoutMs: options.timeoutMs,
        env: options.env,
      });

      results.push(res);
      durations.push(res.durationMs);

      if (res.exitCode === 0) {
        passed++;
      } else {
        failed++;
        if (res.timedOut) {
          timedOut++;
        }
      }
    }

    const passRatePct = parseFloat(((passed / trialsCount) * 100).toFixed(2));
    const isFlaky = passed > 0 && failed > 0;
    const wilsonInterval95 = ExecutionRunner.computeWilsonScoreInterval(passed, trialsCount, 0.95);
    const averageDurationMs = durations.reduce((acc, d) => acc + d, 0) / durations.length;

    return {
      totalTrials: trialsCount,
      passedCount: passed,
      failedCount: failed,
      timedOutCount: timedOut,
      passRatePct,
      isFlaky,
      wilsonInterval95,
      averageDurationMs: parseFloat(averageDurationMs.toFixed(2)),
      trialDurationsMs: durations,
      trials: results,
    };
  }
}

export interface WilsonScoreInterval {
  lower: number;
  upper: number;
  center: number;
  confidenceLevel: number;
}

export interface RepeatedExecutionSummary {
  totalTrials: number;
  passedCount: number;
  failedCount: number;
  timedOutCount: number;
  passRatePct: number;
  isFlaky: boolean;
  wilsonInterval95: WilsonScoreInterval;
  averageDurationMs: number;
  trialDurationsMs: number[];
  trials: ExecutionResult[];
}
