import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';
import { LocatorPlan } from '../selector/candidate-extractor.js';
import { LiveLocatorVerifier } from '../selector/live-locator-verifier.js';

export interface LiveBrowserCollectorOptions {
  executionId?: string;
}

export class LiveBrowserCollector implements EvidenceCollector<void> {
  public readonly name = 'LiveBrowserCollector';
  public readonly source = 'live-browser' as const;

  private records: UnifiedEvidenceRecord[] = [];
  private executionId: string;
  private attachedPage: any = null;
  private listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];

  constructor(options?: LiveBrowserCollectorOptions) {
    this.executionId = options?.executionId ?? `exec-${Date.now()}`;
  }

  /**
   * Attaches live instrumentation listeners to a Playwright Page instance (AUDIT-11).
   * Captures console, page errors, dialogs, crashes, network requests, and responses with frame IDs.
   */
  public attach(page: any): void {
    this.detach();
    this.attachedPage = page;

    if (!page || typeof page.on !== 'function') {
      return;
    }

    const onConsole = (msg: any) => {
      try {
        const text = typeof msg.text === 'function' ? msg.text() : String(msg);
        const type = typeof msg.type === 'function' ? msg.type() : 'log';
        const location = typeof msg.location === 'function' ? msg.location() : undefined;
        const now = Date.now();

        const { redactedText } = EvidenceRedactor.redactText(text);

        const rawRecord: UnifiedEvidenceRecord = {
          evidenceId: `con-${now}-${Math.random().toString(36).slice(2, 8)}`,
          executionId: this.executionId,
          source: 'console',
          timestamp: now,
          evidenceType: 'console-entry',
          payload: {
            type,
            text: redactedText,
            location,
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-console-listener',
          },
          redactionStatus: { isRedacted: true },
        };

        this.records.push(EvidenceRedactor.redactRecord(rawRecord));
      } catch {
        // Safe fail-through
      }
    };

    const onPageError = (err: any) => {
      try {
        const message = err?.message || String(err);
        const stack = err?.stack || '';
        const now = Date.now();

        const { redactedText: cleanMsg } = EvidenceRedactor.redactText(message);
        const { redactedText: cleanStack } = EvidenceRedactor.redactText(stack);

        const rawRecord: UnifiedEvidenceRecord = {
          evidenceId: `err-${now}-${Math.random().toString(36).slice(2, 8)}`,
          executionId: this.executionId,
          source: 'error',
          timestamp: now,
          evidenceType: 'playwright-error',
          payload: {
            errorMessage: cleanMsg,
            errorStack: cleanStack,
            isPageError: true,
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-pageerror-listener',
          },
          redactionStatus: { isRedacted: true },
        };

        this.records.push(EvidenceRedactor.redactRecord(rawRecord));
      } catch {
        // Safe fail-through
      }
    };

    const onRequestFailed = (req: any) => {
      try {
        const url = typeof req.url === 'function' ? req.url() : req.url || '';
        const method = typeof req.method === 'function' ? req.method() : req.method || 'GET';
        const failure = typeof req.failure === 'function' ? req.failure() : null;
        const errorText = failure?.errorText || 'Request Failed';
        const frame = typeof req.frame === 'function' ? req.frame() : null;
        const frameId = frame ? frame.name() || frame.url() : undefined;
        const now = Date.now();

        const { redactedText: cleanUrl } = EvidenceRedactor.redactText(url);

        const rawRecord: UnifiedEvidenceRecord = {
          evidenceId: `net-fail-${now}-${Math.random().toString(36).slice(2, 8)}`,
          executionId: this.executionId,
          source: 'network',
          timestamp: now,
          evidenceType: 'http-response',
          payload: {
            url: cleanUrl,
            method,
            status: 0,
            errorText,
            isFailed: true,
            frameId,
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-requestfailed-listener',
            sourceUri: cleanUrl,
          },
          redactionStatus: { isRedacted: true },
        };

        this.records.push(EvidenceRedactor.redactRecord(rawRecord));
      } catch {
        // Safe fail-through
      }
    };

    const onResponse = async (resp: any) => {
      try {
        const url = typeof resp.url === 'function' ? resp.url() : resp.url || '';
        const status = typeof resp.status === 'function' ? resp.status() : 200;
        const statusText = typeof resp.statusText === 'function' ? resp.statusText() : '';
        const req = typeof resp.request === 'function' ? resp.request() : null;
        const method = req && typeof req.method === 'function' ? req.method() : 'GET';
        const headers = typeof resp.headers === 'function' ? resp.headers() : {};
        const frame = req && typeof req.frame === 'function' ? req.frame() : null;
        const frameId = frame ? frame.name() || frame.url() : undefined;
        const now = Date.now();

        const { redactedHeaders, redactedFields } = EvidenceRedactor.redactHeaders(headers);
        const { redactedText: cleanUrl } = EvidenceRedactor.redactText(url);

        const rawRecord: UnifiedEvidenceRecord = {
          evidenceId: `net-resp-${now}-${Math.random().toString(36).slice(2, 8)}`,
          executionId: this.executionId,
          source: 'network',
          timestamp: now,
          evidenceType: 'http-response',
          payload: {
            url: cleanUrl,
            method,
            status,
            statusText,
            headers: redactedHeaders,
            frameId,
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-response-listener',
            sourceUri: cleanUrl,
          },
          redactionStatus: {
            isRedacted: true,
            redactedFields,
          },
        };

        this.records.push(EvidenceRedactor.redactRecord(rawRecord));
      } catch {
        // Safe fail-through
      }
    };

    const onDialog = (dialog: any) => {
      try {
        const message = typeof dialog.message === 'function' ? dialog.message() : '';
        const type = typeof dialog.type === 'function' ? dialog.type() : 'alert';
        const now = Date.now();
        const { redactedText } = EvidenceRedactor.redactText(message);

        const record: UnifiedEvidenceRecord = {
          evidenceId: `dlg-${now}`,
          executionId: this.executionId,
          source: 'live-browser',
          timestamp: now,
          evidenceType: 'dialog-event',
          payload: { type, message: redactedText },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-dialog-listener',
          },
          redactionStatus: { isRedacted: true },
        };
        this.records.push(record);
      } catch {
        // Safe fail-through
      }
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    if (typeof page.on === 'function') {
      page.on('dialog', onDialog);
    }

    this.listeners = [
      { event: 'console', fn: onConsole },
      { event: 'pageerror', fn: onPageError },
      { event: 'requestfailed', fn: onRequestFailed },
      { event: 'response', fn: onResponse },
      { event: 'dialog', fn: onDialog },
    ];
  }

  /**
   * Captures the full HTML DOM snapshot with central redaction (AUDIT-11 / B5).
   */
  public async captureSnapshot(phase: 'before' | 'action' | 'after' = 'action'): Promise<UnifiedEvidenceRecord | null> {
    if (!this.attachedPage) return null;

    try {
      const now = Date.now();
      let rawHtml = '';
      if (typeof this.attachedPage.content === 'function') {
        rawHtml = await this.attachedPage.content();
      }

      const cleanHtml = EvidenceRedactor.redactDomContent(rawHtml);
      const url = typeof this.attachedPage.url === 'function' ? this.attachedPage.url() : undefined;
      const cleanUrl = url ? EvidenceRedactor.redactText(url).redactedText : undefined;

      const record: UnifiedEvidenceRecord = {
        evidenceId: `dom-${phase}-${now}`,
        executionId: this.executionId,
        source: 'live-browser',
        timestamp: now,
        evidenceType: 'dom-snapshot',
        payload: {
          phase,
          html: cleanHtml,
          url: cleanUrl,
        },
        reliability: 'HIGH',
        provenance: {
          collector: this.name,
          collectedAt: now,
          captureMethod: 'page-content-snapshot',
        },
        redactionStatus: { isRedacted: true },
      };

      this.records.push(record);
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Captures an accessibility snapshot using modern page.ariaSnapshot() or legacy a11y tree.
   */
  public async captureAriaSnapshot(): Promise<UnifiedEvidenceRecord | null> {
    if (!this.attachedPage) return null;

    try {
      const now = Date.now();
      let ariaTree = '';

      if (typeof this.attachedPage.ariaSnapshot === 'function') {
        ariaTree = await this.attachedPage.ariaSnapshot();
      } else if (this.attachedPage.accessibility && typeof this.attachedPage.accessibility.snapshot === 'function') {
        const snap = await this.attachedPage.accessibility.snapshot();
        ariaTree = JSON.stringify(snap, null, 2);
      }

      if (!ariaTree) return null;

      const cleanTree = EvidenceRedactor.redactText(ariaTree).redactedText;

      const record: UnifiedEvidenceRecord = {
        evidenceId: `aria-${now}`,
        executionId: this.executionId,
        source: 'live-browser',
        timestamp: now,
        evidenceType: 'accessibility-snapshot',
        payload: { ariaSnapshot: cleanTree },
        reliability: 'HIGH',
        provenance: {
          collector: this.name,
          collectedAt: now,
          captureMethod: 'page-aria-snapshot',
        },
        redactionStatus: { isRedacted: true },
      };

      this.records.push(record);
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Evaluates a candidate locator or typed LocatorPlan directly against the live page.
   * Empirically tests count(), visibility, and accessibility (AUDIT-13).
   */
  public async evaluateCandidate(planOrSelector: string | LocatorPlan): Promise<{
    count: number;
    visibleCount: number;
    accessibleNames: string[];
    isUnique: boolean;
  }> {
    if (!this.attachedPage) {
      return { count: 0, visibleCount: 0, accessibleNames: [], isUnique: false };
    }

    try {
      if (typeof planOrSelector === 'object') {
        const result = await LiveLocatorVerifier.verify(this.attachedPage, planOrSelector);
        return {
          count: result.count,
          visibleCount: result.isVisible ? 1 : 0,
          accessibleNames: [],
          isUnique: result.isUnique,
        };
      }

      // String selector fallback
      if (typeof this.attachedPage.locator !== 'function') {
        return { count: 0, visibleCount: 0, accessibleNames: [], isUnique: false };
      }

      const loc = this.attachedPage.locator(planOrSelector);
      const count = await loc.count();
      let visibleCount = 0;
      const accessibleNames: string[] = [];

      for (let i = 0; i < count; i++) {
        const el = loc.nth(i);
        if (typeof el.isVisible === 'function' && (await el.isVisible())) {
          visibleCount++;
        }
        if (typeof el.innerText === 'function') {
          const text = await el.innerText().catch(() => '');
          if (text) accessibleNames.push(text.trim());
        }
      }

      return {
        count,
        visibleCount,
        accessibleNames,
        isUnique: count === 1,
      };
    } catch {
      return { count: 0, visibleCount: 0, accessibleNames: [], isUnique: false };
    }
  }

  /**
   * Detaches all event listeners from the page.
   */
  public detach(): void {
    if (this.attachedPage && typeof this.attachedPage.off === 'function') {
      for (const { event, fn } of this.listeners) {
        try {
          this.attachedPage.off(event, fn);
        } catch {
          // Ignore
        }
      }
    }
    this.attachedPage = null;
    this.listeners = [];
  }

  public async collect(): Promise<UnifiedEvidenceRecord[]> {
    return [...this.records];
  }

  public drain(): UnifiedEvidenceRecord[] {
    const dumped = [...this.records];
    this.records = [];
    return dumped;
  }
}
