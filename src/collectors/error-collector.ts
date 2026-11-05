import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';

export interface PlaywrightErrorInput {
  errorMessage: string;
  errorStack?: string;
  testTitle?: string;
  testFile?: string;
  line?: number;
  column?: number;
  executionId?: string;
}

export class ErrorCollector implements EvidenceCollector<PlaywrightErrorInput> {
  public readonly name = 'ErrorCollector';
  public readonly source = 'error' as const;

  public async collect(input: PlaywrightErrorInput): Promise<UnifiedEvidenceRecord[]> {
    const executionId = input.executionId ?? `exec-${Date.now()}`;
    const timestamp = Date.now();

    const {
      errorType,
      action,
      selector,
      sourceFile,
      line,
      column,
      isStrictModeViolation,
      isTimeout,
      isAssertion,
    } = this.parseError(input);

    const { redactedText: cleanMessage } = EvidenceRedactor.redactText(input.errorMessage);
    const { redactedText: cleanStack } = EvidenceRedactor.redactText(input.errorStack ?? '');

    const record: UnifiedEvidenceRecord = {
      evidenceId: `err-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      executionId,
      source: 'error',
      timestamp,
      evidenceType: 'playwright-error',
      payload: {
        errorType,
        action,
        selector,
        sourceFile,
        line,
        column,
        errorMessage: cleanMessage,
        errorStack: cleanStack,
        isStrictModeViolation,
        isTimeout,
        isAssertion,
        testTitle: input.testTitle,
      },
      reliability: 'HIGH',
      provenance: {
        collector: this.name,
        collectedAt: timestamp,
        captureMethod: 'playwright-error-parser',
        sourceUri: sourceFile,
      },
      redactionStatus: {
        isRedacted: false,
      },
    };

    return [record];
  }

  private parseError(input: PlaywrightErrorInput) {
    const rawMsg = input.errorMessage || '';
    const rawStack = input.errorStack || '';

    let errorType = 'Error';
    let isStrictModeViolation = false;
    let isTimeout = false;
    let isAssertion = false;
    let action = 'action';
    let selector: string | undefined;

    const lower = rawMsg.toLowerCase();

    // Strict mode
    if (lower.includes('strict mode violation') || lower.includes('resolved to') && lower.includes('elements')) {
      errorType = 'StrictModeViolation';
      isStrictModeViolation = true;
    } else if (lower.includes('timeout') || lower.includes('timed out')) {
      errorType = 'TimeoutError';
      isTimeout = true;
    } else if (
      lower.includes('expect(') ||
      lower.includes('received:') ||
      lower.includes('to have text') ||
      lower.includes('to be visible')
    ) {
      errorType = 'AssertionError';
      isAssertion = true;
      action = 'expect';
    }

    // Action extraction
    const actionMatch = rawMsg.match(
      /(?:page\.|locator\([^)]+\)\.)(click|fill|press|type|check|uncheck|hover|selectOption|waitFor|dblclick)\b/i
    );
    if (actionMatch && actionMatch[1]) {
      action = actionMatch[1].toLowerCase();
    } else if (lower.includes('click')) {
      action = 'click';
    } else if (lower.includes('fill')) {
      action = 'fill';
    } else if (lower.includes('select')) {
      action = 'selectOption';
    }

    // Selector extraction patterns
    // 1. waiting for locator('...') or locator("...")
    const locatorMatch = rawMsg.match(/waiting for (?:locator|getByRole|getByText|getByTestId|getByLabel)\((['"`].+?['"`])\)/);
    if (locatorMatch && locatorMatch[1]) {
      selector = locatorMatch[1].slice(1, -1);
    } else {
      // 2. waiting for selector "..."
      const selectorMatch = rawMsg.match(/waiting for selector ["'](.+?)["']/);
      if (selectorMatch && selectorMatch[1]) {
        selector = selectorMatch[1];
      } else {
        // 3. locator('...') in message
        const directLocator = rawMsg.match(/locator\((['"`].+?['"`])\)/);
        if (directLocator && directLocator[1]) {
          selector = directLocator[1].slice(1, -1);
        } else {
          // 4. Strict mode violation: locator('...') resolved to N elements
          const strictMatch = rawMsg.match(/strict mode violation:\s*(.+?)\s+resolved to/i);
          if (strictMatch && strictMatch[1]) {
            selector = strictMatch[1];
          }
        }
      }
    }

    // Source location parsing
    let sourceFile = input.testFile;
    let line = input.line;
    let column = input.column;

    if (!sourceFile && rawStack) {
      // Find stack line pointing to a spec or page file
      const lines = rawStack.split('\n');
      for (const l of lines) {
        const stackMatch = l.match(/at\s+(?:.*?\s+)?\(?(.*?):(\d+):(\d+)\)?$/);
        if (stackMatch && stackMatch[1]) {
          const file = stackMatch[1];
          if (!file.includes('node_modules') && (file.endsWith('.ts') || file.endsWith('.js'))) {
            sourceFile = file;
            if (stackMatch[2]) line = parseInt(stackMatch[2], 10);
            if (stackMatch[3]) column = parseInt(stackMatch[3], 10);
            break;
          }
        }
      }
    }

    return {
      errorType,
      action,
      selector,
      sourceFile,
      line,
      column,
      isStrictModeViolation,
      isTimeout,
      isAssertion,
    };
  }
}
