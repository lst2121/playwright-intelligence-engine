import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DiagnosticContext, NetworkEvent, FailureCategory } from '../core/types/diagnostic-context.js';

export interface BugTicketInput {
  context: DiagnosticContext;
  tracePath: string;
  workspaceRoot?: string | undefined;
  testTitle?: string | undefined;
  testFile?: string | undefined;
  category?: FailureCategory | undefined;
  offendingNetworkEvent?: NetworkEvent | undefined;
  abstentionReason?: string | undefined;
}

export interface BugTicket {
  ticketId: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  category: FailureCategory;
  detectedAt: string;
  testFile: string;
  testTitle: string;
  failedAction: string;
  summary: string;
  reproductionCurl?: string | undefined;
  harExcerpt?: {
    request: {
      method: string;
      url: string;
      headers?: Record<string, string> | undefined;
    };
    response: {
      status: number;
      statusText?: string | undefined;
      headers?: Record<string, string> | undefined;
      errorText?: string | undefined;
    };
    timingMs?: number | undefined;
  } | undefined;
  consoleErrors: string[];
  screenshotPath?: string | undefined;
  justification: string;
  markdown: string;
  jiraMarkup: string;
  savedPath?: string | undefined;
}

/**
 * Generates an unedited, copy-pasteable curl reproduction command
 * from a failing network event.
 */
export function generateReproductionCurl(event: NetworkEvent): string {
  const method = (event.method || 'GET').toUpperCase();
  const parts: string[] = [`curl -X ${method} "${event.url}"`];

  if (event.headers) {
    for (const [key, val] of Object.entries(event.headers)) {
      // Redact sensitive authorization headers while preserving content-type and custom headers
      if (/cookie|authorization|bearer/i.test(key)) {
        parts.push(`  -H "${key}: [REDACTED_AUTH_TOKEN]"`);
      } else {
        parts.push(`  -H "${key}: ${val}"`);
      }
    }
  }

  return parts.join(' \\\n');
}

export class BugTicketGenerator {
  /**
   * Generates a ready-to-file GitHub/Jira defect ticket when a Negative Control triggers.
   */
  public static generate(input: BugTicketInput): BugTicket {
    const now = new Date();
    const timestampStr = now.toISOString();
    const idSuffix = crypto.randomBytes(4).toString('hex');
    const ticketId = `DEFECT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${idSuffix}`;

    const failedAction = input.context.failedAction;
    const testFile = input.testFile ?? failedAction.sourceFile ?? 'unknown.spec.ts';
    const testTitle = input.testTitle ?? 'Unnamed Playwright Test';
    const actionDesc = `${failedAction.action}(${failedAction.selector ?? ''})`.replace(/\(\)/, '');

    // Identify offending network event if not explicitly supplied
    let offending = input.offendingNetworkEvent;
    if (!offending) {
      offending = input.context.networkEvents.find((n) => n.status >= 500 && !/favicon|intercom|clarity/i.test(n.url))
        ?? input.context.networkEvents.find((n) => (n.status === 401 || n.status === 403) && !/favicon/i.test(n.url))
        ?? input.context.networkEvents.find((n) => n.status === 404 && /\.(?:json|api|action)/i.test(n.url));
    }

    // Determine category
    const category: FailureCategory = input.category
      ?? (offending && offending.status >= 500 ? 'BACKEND_500' : offending && (offending.status === 401 || offending.status === 403) ? 'AUTH_EXPIRED' : input.context.failureCategory ?? 'ENVIRONMENT_FAILURE');

    // Severity mapping
    let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'HIGH';
    if (category === 'BACKEND_500' || (offending && offending.status >= 500)) {
      severity = 'CRITICAL';
    } else if (category === 'AUTH_EXPIRED') {
      severity = 'HIGH';
    } else {
      severity = 'MEDIUM';
    }

    // Offending summary & title
    let title: string;
    let summary: string;

    if (offending) {
      const parsedUrl = new URL(offending.url);
      const endpoint = `${offending.method.toUpperCase()} ${parsedUrl.pathname}`;
      title = `[Defect][${severity}] Backend HTTP ${offending.status} on ${endpoint}`;
      summary = `Test '${testTitle}' in '${testFile}' encountered an application server defect (HTTP ${offending.status}) on '${offending.url}'. Playwright Intelligence Engine's Gate 0 detected server causality and strictly abstained from mutating test locators or assertions.`;
    } else if (category === 'NETWORK_OFFLINE') {
      title = `[Defect][${severity}] Test Environment Offline / Unreachable Network`;
      summary = `Test '${testTitle}' failed because the target network host was unreachable or offline. UI locator modification was prohibited.`;
    } else {
      title = `[Defect][${severity}] Negative Control Triggered on ${path.basename(testFile)}`;
      summary = input.abstentionReason ?? `Test '${testTitle}' failed due to an environmental or application defect. Code repair was safely blocked.`;
    }

    // Reproduction curl
    const reproductionCurl = offending ? generateReproductionCurl(offending) : undefined;

    // HAR excerpt
    const harExcerpt = offending
      ? {
          request: {
            method: offending.method.toUpperCase(),
            url: offending.url,
            headers: offending.headers,
          },
          response: {
            status: offending.status,
            statusText: offending.statusText ?? (offending.status === 500 ? 'Internal Server Error' : undefined),
            errorText: offending.errorText,
          },
          timingMs: offending.durationMs,
        }
      : undefined;

    // Filter console errors
    const consoleErrors = input.context.consoleEvents
      .filter((c) => c.type === 'error' || /500|failed|error|exception/i.test(c.text))
      .map((c) => `[${c.type.toUpperCase()}] ${c.text}`)
      .slice(0, 10);

    // Justification
    const justification = `Negative Control Triggered (${category}): Test failure was caused by backend service instability or environmental failure, NOT locator drift or selector ambiguity. Attempting to heal test selectors would introduce false-positive test degradation. Automated repair was strictly aborted.`;

    // Markdown (GitHub Issue Ready)
    const mdLines: string[] = [
      `# ${title}`,
      '',
      `**Ticket ID:** \`${ticketId}\`  `,
      `**Classification:** \`${category}\` (Negative Control Triggered)  `,
      `**Severity:** **${severity}**  `,
      `**Detection Timestamp:** \`${timestampStr}\`  `,
      `**Gate 0 Decision:** **STRICT ABSTENTION** (Source & Assertion Integrity Preserved)  `,
      '',
      '---',
      '',
      '### 1. Executive Summary',
      summary,
      '',
      '### 2. Failure Details',
      `- **Test Specification:** \`${testFile}\``,
      `- **Test Title:** \`${testTitle}\``,
      `- **Failed Action:** \`${actionDesc}\``,
      `- **Error Message:** \`${failedAction.errorMessage ?? 'Timeout / Error'}\``,
      '',
    ];

    if (offending) {
      mdLines.push(
        '### 3. Offending Network Event',
        `- **Endpoint:** \`${offending.method.toUpperCase()} ${offending.url}\``,
        `- **HTTP Status:** \`${offending.status} ${offending.statusText ?? ''}\``,
        `- **Latency:** \`${offending.durationMs ?? 0}ms\``,
        '',
        '#### HAR Excerpt',
        '```json',
        JSON.stringify(harExcerpt, null, 2),
        '```',
        '',
        '#### Reproduction Command',
        '```bash',
        reproductionCurl!,
        '```',
        ''
      );
    }

    if (consoleErrors.length > 0) {
      mdLines.push(
        '### 4. Console & Browser Diagnostics',
        '```',
        consoleErrors.join('\n'),
        '```',
        ''
      );
    }

    mdLines.push(
      '### 5. Architectural Justification',
      `> ${justification}`,
      '',
      '---',
      '*Generated automatically by Playwright Intelligence Engine (PIE) Gate 0 Negative Control Sentinel.*'
    );

    const markdown = mdLines.join('\n');

    // Jira Markup Format
    const jiraLines: string[] = [
      `h1. ${title}`,
      `*Ticket ID:* {{${ticketId}}}`,
      `*Classification:* {{${category}}}`,
      `*Severity:* *${severity}*`,
      `*Timestamp:* {{${timestampStr}}}`,
      '',
      'h2. Executive Summary',
      summary,
      '',
      'h2. Failure Details',
      `* *Test Specification:* {{${testFile}}}`,
      `* *Test Title:* {{${testTitle}}}`,
      `* *Failed Action:* {{${actionDesc}}}`,
      `* *Error Message:* {{${failedAction.errorMessage ?? 'Timeout / Error'}}}`,
      '',
    ];

    if (offending) {
      jiraLines.push(
        'h2. Offending Network Event',
        `* *Endpoint:* {{${offending.method.toUpperCase()} ${offending.url}}}`,
        `* *HTTP Status:* *${offending.status}*`,
        '',
        'h3. Reproduction cURL',
        '{code:bash}',
        reproductionCurl!,
        '{code}',
        ''
      );
    }

    jiraLines.push(
      'h2. Gate 0 Justification',
      `{quote}${justification}{quote}`
    );

    const jiraMarkup = jiraLines.join('\n');

    // Save ticket to disk if workspaceRoot is available
    let savedPath: string | undefined;
    const workspaceRoot = input.workspaceRoot ?? process.cwd();
    try {
      const storageDir = process.env.PIE_STORAGE_DIR ?? path.resolve(workspaceRoot, '.pw-intelligence');
      const reportsDir = path.join(storageDir, 'bug-reports');
      fs.mkdirSync(reportsDir, { recursive: true });

      const mdPath = path.join(reportsDir, `${ticketId}.md`);
      const jsonPath = path.join(reportsDir, `${ticketId}.json`);

      fs.writeFileSync(mdPath, markdown, 'utf-8');
      fs.writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            ticketId,
            title,
            severity,
            category,
            detectedAt: timestampStr,
            testFile,
            testTitle,
            failedAction: actionDesc,
            summary,
            reproductionCurl,
            harExcerpt,
            consoleErrors,
            justification,
          },
          null,
          2
        ),
        'utf-8'
      );
      savedPath = mdPath;
    } catch {
      // Safe fallback if filesystem is read-only
    }

    return {
      ticketId,
      title,
      severity,
      category,
      detectedAt: timestampStr,
      testFile,
      testTitle,
      failedAction: actionDesc,
      summary,
      reproductionCurl,
      harExcerpt,
      consoleErrors,
      justification,
      markdown,
      jiraMarkup,
      savedPath,
    };
  }
}
