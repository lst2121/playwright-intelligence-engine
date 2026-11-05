import { EvidenceCollector } from './collector-interface.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';

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
   * Attaches live instrumentation listeners to a Playwright Page instance.
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

        this.records.push({
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
          redactionStatus: { isRedacted: false },
        });
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

        this.records.push({
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
          redactionStatus: { isRedacted: false },
        });
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
        const now = Date.now();

        const { redactedText: cleanUrl } = EvidenceRedactor.redactText(url);

        this.records.push({
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
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-requestfailed-listener',
            sourceUri: cleanUrl,
          },
          redactionStatus: { isRedacted: false },
        });
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
        const now = Date.now();

        const { redactedHeaders, redactedFields } = EvidenceRedactor.redactHeaders(headers);
        const { redactedText: cleanUrl } = EvidenceRedactor.redactText(url);

        this.records.push({
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
          },
          reliability: 'HIGH',
          provenance: {
            collector: this.name,
            collectedAt: now,
            captureMethod: 'page-response-listener',
            sourceUri: cleanUrl,
          },
          redactionStatus: {
            isRedacted: redactedFields.length > 0,
            redactedFields,
          },
        });
      } catch {
        // Safe fail-through
      }
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);

    this.listeners = [
      { event: 'console', fn: onConsole },
      { event: 'pageerror', fn: onPageError },
      { event: 'requestfailed', fn: onRequestFailed },
      { event: 'response', fn: onResponse },
    ];
  }

  /**
   * Captures the full HTML DOM and/or accessibility tree from the attached page.
   */
  public async captureSnapshot(phase: 'before' | 'action' | 'after' = 'action'): Promise<UnifiedEvidenceRecord | null> {
    if (!this.attachedPage) return null;

    try {
      const now = Date.now();
      let html = '';
      if (typeof this.attachedPage.content === 'function') {
        html = await this.attachedPage.content();
      }

      const record: UnifiedEvidenceRecord = {
        evidenceId: `dom-${phase}-${now}`,
        executionId: this.executionId,
        source: 'live-browser',
        timestamp: now,
        evidenceType: 'dom-snapshot',
        payload: {
          phase,
          html,
          url: typeof this.attachedPage.url === 'function' ? this.attachedPage.url() : undefined,
        },
        reliability: 'HIGH',
        provenance: {
          collector: this.name,
          collectedAt: now,
          captureMethod: 'page-content-snapshot',
        },
        redactionStatus: { isRedacted: false },
      };

      this.records.push(record);
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Evaluates a candidate locator directly against the live page to verify uniqueness and visibility.
   */
  public async evaluateCandidate(selector: string): Promise<{
    count: number;
    visibleCount: number;
    accessibleNames: string[];
  }> {
    if (!this.attachedPage || typeof this.attachedPage.locator !== 'function') {
      return { count: 0, visibleCount: 0, accessibleNames: [] };
    }

    try {
      const loc = this.attachedPage.locator(selector);
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

      return { count, visibleCount, accessibleNames };
    } catch {
      return { count: 0, visibleCount: 0, accessibleNames: [] };
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

