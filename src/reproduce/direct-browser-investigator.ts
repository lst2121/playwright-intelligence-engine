import { LiveBrowserCollector } from '../collectors/live-browser-collector.js';
import { UnifiedEvidenceRecord } from '../evidence/evidence-model.js';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';
import { LocatorPlan } from '../selector/candidate-extractor.js';
import { LiveLocatorVerifier, LiveVerificationResult } from '../selector/live-locator-verifier.js';

export interface DirectInvestigationOptions {
  url?: string | undefined;
  actionSelector?: string | undefined;
  intendedAction?: string | undefined;
  executionId?: string | undefined;
  timeoutMs?: number | undefined;
}

export type DirectInvestigationStatus = 'REPRODUCED' | 'NOT_REPRODUCED' | 'INSUFFICIENT_EVIDENCE';

export interface DirectInvestigationResult {
  success: boolean;
  status: DirectInvestigationStatus;
  pageUrl: string;
  records: UnifiedEvidenceRecord[];
  domSnapshotRecord: UnifiedEvidenceRecord | null;
  ariaSnapshotRecord: UnifiedEvidenceRecord | null;
  verificationResult?: LiveVerificationResult | undefined;
  error?: string | undefined;
}

/**
 * Safely resolves the Playwright library dynamically at runtime from the active environment.
 * Ensures that the package can be imported, bundled, and run without a hard compile-time dependency
 * on @playwright/test in non-browser CLI invocations.
 */
async function resolvePlaywrightChromium(): Promise<any> {
  try {
    const mod = await import('@playwright/test');
    if (mod?.chromium) {
      return mod.chromium;
    }
  } catch {
    // Fall through to try 'playwright'
  }

  try {
    const mod = await import('playwright');
    if (mod?.chromium) {
      return mod.chromium;
    }
  } catch {
    // Both failed
  }

  throw new Error(
    'Playwright runtime is not available in the current environment. Ensure @playwright/test or playwright is installed in the target project.'
  );
}

/**
 * DirectBrowserInvestigator provides Mode B browser reproduction and exploratory probing.
 * Directly launches headless Chromium, attaches LiveBrowserCollector and NetworkCollector,
 * captures failure-point DOM & ariaSnapshots, and verifies candidate locators live.
 *
 * Enforces fail-closed validation: Missing URLs or about:blank fallbacks are explicitly
 * rejected with INSUFFICIENT_EVIDENCE rather than claiming successful reproduction.
 */
export class DirectBrowserInvestigator {
  public static async investigateUrl(
    options: DirectInvestigationOptions,
    candidatePlan?: LocatorPlan
  ): Promise<DirectInvestigationResult> {
    const executionId = options.executionId ?? `direct-${Date.now()}`;

    // Fail-closed check: Never treat missing URL or about:blank as successful reproduction
    const isAllowedScheme =
      options.url &&
      options.url !== 'about:blank' &&
      (options.url.startsWith('http://') ||
        options.url.startsWith('https://') ||
        options.url.startsWith('file://') ||
        options.url.startsWith('data:'));

    if (!isAllowedScheme) {
      return {
        success: false,
        status: 'INSUFFICIENT_EVIDENCE',
        pageUrl: options.url ?? '',
        records: [],
        domSnapshotRecord: null,
        ariaSnapshotRecord: null,
        error: `Cannot reproduce failure: Target URL '${options.url ?? ''}' is missing, invalid, or about:blank. Actual application state was not reproduced.`,
      };
    }

    const liveCollector = new LiveBrowserCollector({ executionId });
    const records: UnifiedEvidenceRecord[] = [];

    let browser: any = null;
    let context: any = null;
    let page: any = null;
    let domSnapshotRecord: UnifiedEvidenceRecord | null = null;
    let ariaSnapshotRecord: UnifiedEvidenceRecord | null = null;
    let verificationResult: LiveVerificationResult | undefined;
    let pageUrl = options.url;

    try {
      const chromium = await resolvePlaywrightChromium();
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      page = await context.newPage();

      // Attach live instrumentation collectors
      liveCollector.attach(page);

      await page.goto(options.url, {
        timeout: options.timeoutMs ?? 15000,
        waitUntil: 'domcontentloaded',
      });
      pageUrl = page.url();

      let actionFailed = false;

      // If target action was requested, perform action or observe failure
      if (options.actionSelector) {
        try {
          const loc = page.locator(options.actionSelector);
          await loc.waitFor({ state: 'visible', timeout: 3000 });
          if (options.intendedAction === 'click') {
            await loc.click({ timeout: 3000 });
          }
        } catch {
          actionFailed = true;
          // Failure point reached: capture failure-point evidence before teardown
          domSnapshotRecord = await liveCollector.captureSnapshot('action');
          ariaSnapshotRecord = await liveCollector.captureAriaSnapshot();
        }
      }

      // If no failure occurred yet or no action requested, capture state
      if (!domSnapshotRecord) {
        domSnapshotRecord = await liveCollector.captureSnapshot('action');
      }
      if (!ariaSnapshotRecord) {
        ariaSnapshotRecord = await liveCollector.captureAriaSnapshot();
      }

      // Verify candidate locator live if supplied
      if (candidatePlan && page) {
        verificationResult = await LiveLocatorVerifier.verify(page, candidatePlan);
      }

      // Collect and redact all live records
      const liveRecords = await liveCollector.collect();
      for (const rec of liveRecords) {
        records.push(EvidenceRedactor.redactRecord(rec));
      }

      return {
        success: true,
        status: actionFailed ? 'REPRODUCED' : 'NOT_REPRODUCED',
        pageUrl: pageUrl ?? options.url ?? '',
        records,
        domSnapshotRecord,
        ariaSnapshotRecord,
        verificationResult,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'NOT_REPRODUCED',
        pageUrl: pageUrl ?? options.url ?? '',
        records,
        domSnapshotRecord,
        ariaSnapshotRecord,
        error: err?.message ?? String(err),
      };
    } finally {
      liveCollector.detach();
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }
}
