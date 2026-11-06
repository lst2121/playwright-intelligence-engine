import { describe, expect, it } from 'vitest';
import { DiagnosticContext } from '../../src/core/types/diagnostic-context.js';
import { parseExternalFailureEvidence, supplementDiagnosticContext } from '../../src/diagnostics/external-failure-evidence.js';

const fallbackContext: DiagnosticContext = {
  playwrightVersion: '1.64.1',
  traceFormatVersion: 10,
  failedAction: { callId: 'unknown', action: 'unknown', errorMessage: 'No explicit action failure recorded in trace' },
  snapshots: {},
  networkEvents: [],
  consoleEvents: [],
  evidenceCompleteness: { domAvailable: false, networkAvailable: false, sourceAvailable: false },
};

describe('external Playwright failure evidence', () => {
  it('parses error-context files and extracts action, selector, and source location', () => {
    const evidence = parseExternalFailureEvidence(`Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8000/\n\nCall log:\n- waiting for locator("#login")\n    at LoginPage.goToMainPage (D:\\repo\\pages\\loginPage.ts:34:21)`);
    expect(evidence.errorMessage).toContain('ERR_CONNECTION_REFUSED');
    expect(evidence.action).toBe('page.goto');
    expect(evidence.selector).toBe('#login');
    expect(evidence.sourceFile).toContain('loginPage.ts');
    expect(evidence.line).toBe(34);
  });

  it('supplements a trace fallback without overwriting existing trace action evidence', () => {
    const supplemented = supplementDiagnosticContext(fallbackContext, {
      errorMessage: 'page.goto: net::ERR_CONNECTION_REFUSED',
      action: 'page.goto',
      sourceFile: 'pages/loginPage.ts',
      line: 34,
    });
    expect(supplemented.failedAction.action).toBe('page.goto');
    expect(supplemented.failedAction.errorMessage).toContain('ERR_CONNECTION_REFUSED');

    const existing = supplementDiagnosticContext({ ...fallbackContext, failedAction: { ...fallbackContext.failedAction, callId: 'action@1', action: 'page.click', errorMessage: 'existing failure' } }, {
      errorMessage: 'replacement failure',
      action: 'page.goto',
    });
    expect(existing.failedAction.errorMessage).toBe('existing failure');
  });
});
