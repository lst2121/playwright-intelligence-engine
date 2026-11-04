import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { SnapshotResolver, NodeSnapshot } from '../../src/trace/snapshot-resolver.js';
import { EvidenceCorrelator } from '../../src/diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../../src/diagnostics/diagnostic-report.js';
import { ExecutionRunner } from '../../src/sandbox/execution-runner.js';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';

describe('Phase 1 Diagnostics & Sandbox Tests', () => {
  it('should resolve NodeSnapshot tuples into interactive elements', () => {
    // Array-based NodeSnapshot tuple: [tag, attrs, ...children]
    const sampleSnapshot: NodeSnapshot = [
      'DIV',
      { class: 'container' },
      ['H1', {}, 'Welcome to OrangeHRM'],
      [
        'FORM',
        { id: 'login-form' },
        ['INPUT', { type: 'text', name: 'username', placeholder: 'Username' }],
        ['BUTTON', { type: 'submit', class: 'oxd-button' }, 'Login'],
      ],
    ];

    const resolved = SnapshotResolver.resolveNode(sampleSnapshot);
    expect(resolved).not.toBeNull();
    expect(resolved!.tag).toBe('div');

    const interactive = SnapshotResolver.extractInteractiveElements(resolved!);
    expect(interactive.length).toBe(2); // input and button
    expect(interactive[0]!.tag).toBe('input');
    expect(interactive[0]!.role).toBe('textbox');
    expect(interactive[1]!.tag).toBe('button');
    expect(interactive[1]!.role).toBe('button');
    expect(interactive[1]!.text).toBe('Login');

    const html = SnapshotResolver.toHtml(resolved!);
    expect(html).toContain('<form id="login-form">');
    expect(html).toContain('Login');
  });

  it('should generate a comprehensive terminal diagnostic report with evidence correlation', () => {
    const context: DiagnosticContext = {
      playwrightVersion: '1.45.0',
      traceFormatVersion: 6,
      failedAction: {
        callId: 'call@101',
        action: 'locator.click',
        selector: 'button.btn-primary',
        sourceFile: 'tests/e2e/login.spec.ts',
        line: 25,
        errorMessage: 'Timeout 30000ms exceeded waiting for locator("button.btn-primary")',
        durationMs: 30000,
      },
      snapshots: {},
      networkEvents: [
        {
          url: 'https://app.example.com/api/v1/auth/token',
          method: 'POST',
          status: 401,
          statusText: 'Unauthorized',
          timestamp: 1000,
        },
      ],
      consoleEvents: [
        {
          type: 'error',
          text: 'Uncaught (in promise) Error: Session expired',
          timestamp: 1050,
        },
      ],
      evidenceCompleteness: {
        domAvailable: false,
        networkAvailable: true,
        sourceAvailable: true,
      },
    };

    const correlated = EvidenceCorrelator.correlate(context);
    expect(correlated.classification.category).toBe('AUTH_EXPIRED');
    expect(correlated.classification.shouldAbstain).toBe(true);

    const report = DiagnosticReportGenerator.generateTerminalReport(correlated);
    expect(report).toContain('AUTH_EXPIRED');
    expect(report).toContain('⛔ ABSTAIN FROM CODE REPAIR');
    expect(report).toContain('HTTP 401 [POST] https://app.example.com/api/v1/auth/token');
    expect(report).toContain('Uncaught (in promise) Error: Session expired');
  });

  it('should run commands safely using ExecutionRunner without shell injection', async () => {
    const result = await ExecutionRunner.run('git', {
      cwd: path.resolve('.'),
      args: ['status', '--short'],
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});
