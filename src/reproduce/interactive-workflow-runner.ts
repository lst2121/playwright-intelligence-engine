import fs from 'node:fs/promises';
import path from 'node:path';
import { EvidenceRedactor } from '../evidence/evidence-redactor.js';
import { NetworkCollector, type RawNetworkEvent } from '../collectors/network-collector.js';
import { LiveLocatorVerifier } from '../selector/live-locator-verifier.js';
import type { LocatorPlan } from '../selector/candidate-extractor.js';
import {
  ExplorationActionRecord,
  ExplorationContextBundle,
  ExplorationFinding,
  ExplorationNetworkRecord,
  loadExplorationContextBundle,
  redactExplorationBundle,
  sanitizeUrlSecrets,
  saveExplorationContextBundle,
  ScenarioExplorationStatus,
  VerificationLayerStatus,
  VerifiedLocatorEvidence,
} from '../intelligence/evidence-bundle.js';

function buildExplorationContextBundleUrlSanitized(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return sanitizeUrlSecrets(baseUrl);
}
import {
  buildBrownfieldRepositoryGraph,
  type BrownfieldRepositoryGraph,
} from '../intelligence/repository-profile.js';
import type {
  GenerationWorkflowPlan,
  PlannedWorkflowScenario,
} from '../intelligence/workflow-planner.js';

export interface ControlledLoginConfig {
  loginUrl: string;
  usernameSelector?: string | undefined;
  passwordSelector?: string | undefined;
  submitSelector?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
}

export interface DbVerificationResult {
  status: VerificationLayerStatus;
  summary: string;
}

export interface InteractiveExplorerOptions {
  baseUrl?: string | undefined;
  workspaceRoot?: string | undefined;
  workflowPlan: GenerationWorkflowPlan;
  checkpointPath?: string | undefined;
  storageStatePath?: string | undefined;
  loginConfig?: ControlledLoginConfig | undefined;
  allowMutatingActions?: boolean | undefined;
  allowDestructiveActions?: boolean | undefined;
  designatedTestEnvironment?: boolean | undefined;
  maxActionsPerScenario?: number | undefined;
  timeoutMs?: number | undefined;
  browser?: any;
  page?: any;
  dbVerifier?: ((scenario: PlannedWorkflowScenario, actions: ExplorationActionRecord[]) => Promise<DbVerificationResult>) | undefined;
  repositoryGraph?: BrownfieldRepositoryGraph | undefined;
  onCheckpoint?: ((bundle: ExplorationContextBundle) => void | Promise<void>) | undefined;
  simulateCrashAfterScenarioIndex?: number | undefined;
}

const DESTRUCTIVE_TEXT_RE = /\b(delete\s+account|destroy\s+database|drop\s+table|charge\s+card|complete\s+real\s+payment|wipe\s+all)\b/i;

function isLocalhostUrl(url?: string): boolean {
  if (!url) return false;
  return /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(url);
}

interface RawDomElementInfo {
  tag: string;
  role: string;
  accessibleName: string;
  placeholder?: string | undefined;
  label?: string | undefined;
  testId?: string | undefined;
  type?: string | undefined;
  visible: boolean;
  frameSelector?: string | undefined;
}

function buildLocatorPlanFromDom(el: RawDomElementInfo): {
  strategy: VerifiedLocatorEvidence['strategy'];
  expression: string;
  plan: LocatorPlan;
} {
  if (el.testId) {
    return {
      strategy: 'testId',
      expression: `page.getByTestId(${JSON.stringify(el.testId)})`,
      plan: { kind: 'getByTestId', testId: el.testId },
    };
  }
  if (el.placeholder) {
    return {
      strategy: 'placeholder',
      expression: `page.getByPlaceholder(${JSON.stringify(el.placeholder)})`,
      plan: { kind: 'getByPlaceholder', placeholder: el.placeholder },
    };
  }
  if (el.label && (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select')) {
    return {
      strategy: 'label',
      expression: `page.getByLabel(${JSON.stringify(el.label)})`,
      plan: { kind: 'getByLabel', label: el.label },
    };
  }
  if (el.role && el.accessibleName) {
    return {
      strategy: 'role',
      expression: `page.getByRole(${JSON.stringify(el.role)}, { name: ${JSON.stringify(el.accessibleName)} })`,
      plan: { kind: 'getByRole', role: el.role, options: { name: el.accessibleName } },
    };
  }
  return {
    strategy: 'css',
    expression: `page.locator(${JSON.stringify(el.tag)})`,
    plan: { kind: 'locator', selector: el.tag },
  };
}

async function captureVisibleTextSnapshot(page: any): Promise<{ summary: string; lines: string[] }> {
  try {
    const raw = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const bodyText = (doc?.body?.innerText ?? '').trim();
      const lines = bodyText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean).slice(0, 60);
      return {
        summary: lines.join(' | ').slice(0, 1200),
        lines,
      };
    });
    return raw;
  } catch {
    return { summary: '', lines: [] };
  }
}

async function collectInteractiveControls(page: any): Promise<RawDomElementInfo[]> {
  try {
    const raw = await page.$$eval(
      'input, textarea, select, button, a[href], [role="button"], [role="textbox"], [role="checkbox"], [role="status"], [role="alert"], h1, h2, h3',
      (nodes: any[]) =>
        nodes.slice(0, 80).map((el) => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || undefined;
          let role = el.getAttribute('role') || '';
          if (!role) {
            if (tag === 'button' || (tag === 'input' && (type === 'submit' || type === 'button'))) role = 'button';
            else if (tag === 'input' && type === 'checkbox') role = 'checkbox';
            else if (tag === 'input' || tag === 'textarea') role = 'textbox';
            else if (tag === 'select') role = 'combobox';
            else if (tag === 'a') role = 'link';
            else if (/^h[1-3]$/.test(tag)) role = 'heading';
          }
          const placeholder = el.getAttribute('placeholder') || undefined;
          const label = el.getAttribute('aria-label') || el.getAttribute('name') || undefined;
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined;
          const accessibleName = (el.getAttribute('aria-label') || el.innerText || placeholder || '').trim().slice(0, 120);
          const visible = Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          return { tag, role, accessibleName, placeholder, label, testId, type, visible };
        }),
    );
    return raw.filter((r: RawDomElementInfo) => r.visible);
  } catch {
    return [];
  }
}

function diffLines(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const diffs: string[] = [];
  for (const line of after) {
    if (!beforeSet.has(line)) diffs.push(`+ ${line}`);
  }
  for (const line of before) {
    if (!afterSet.has(line)) diffs.push(`- ${line}`);
  }
  return diffs.slice(0, 40);
}

export class InteractiveWorkflowRunner {
  /**
   * Executes workflow exploration & manual verification in a single native Playwright session
   * with action-level checkpoints, passive defect classification, and redaction.
   */
  public static async run(options: InteractiveExplorerOptions): Promise<ExplorationContextBundle> {
    const repoGraph = options.repositoryGraph ?? (
      options.workspaceRoot ? await buildBrownfieldRepositoryGraph(options.workspaceRoot) : undefined
    );
    const topology: ExplorationContextBundle['topology'] = !options.baseUrl
      ? 'source-only'
      : repoGraph?.topology === 'monorepo'
        ? 'monorepo'
        : 'standalone';

    const bundleId = `explore-${Date.now()}`;
    const networkCollector = new NetworkCollector();
    const rawNetworkEvents: RawNetworkEvent[] = [];
    const networkRecords: ExplorationNetworkRecord[] = [];
    const consoleErrors: string[] = [];
    const verifiedLocators: VerifiedLocatorEvidence[] = [];
    const seenLocatorExpr = new Set<string>();
    const actionRecords: ExplorationActionRecord[] = [];
    const findings: ExplorationFinding[] = [];
    const scenarioStatuses: ScenarioExplorationStatus[] = [];
    const persistenceObservations: ExplorationContextBundle['persistenceObservations'] = [];
    const routesMap = new Map<string, { route: string; title?: string; discoveredAt: string; locatorIds: string[] }>();
    const limitations: string[] = [];
    const evidenceIndex: ExplorationContextBundle['evidenceIndex'] = [];

    const authMethod: ExplorationContextBundle['authentication']['method'] = options.storageStatePath
      ? 'storage-state'
      : options.loginConfig
        ? 'login-flow'
        : (repoGraph?.storageStatePaths.length ?? 0) > 0
          ? 'existing-fixture'
          : 'none';
    let authenticated = authMethod === 'storage-state';

    const buildSnapshot = (runtimeVerified: boolean): ExplorationContextBundle => {
      const sanitizedBase = buildExplorationContextBundleUrlSanitized(options.baseUrl);
      const bundle: ExplorationContextBundle = {
        bundleVersion: '1.0',
        bundleId,
        createdAt: new Date().toISOString(),
        topology,
        runtimeVerified,
        ...(sanitizedBase ? { baseUrl: sanitizedBase } : {}),
        authentication: {
          configured: authMethod !== 'none',
          method: authMethod,
          authenticated,
          secretsExposed: false,
        },
        requirements: {
          featureName: options.workflowPlan.featureName,
          requirementIds: options.workflowPlan.requirements.map((r) => r.id),
          scenarioIds: options.workflowPlan.scenarios.map((s) => s.id),
          workflowPlanHash: options.workflowPlan.planHash,
        },
        routes: [...routesMap.values()],
        locators: verifiedLocators,
        actions: actionRecords,
        network: networkRecords,
        consoleErrors: [...new Set(consoleErrors)],
        persistenceObservations,
        scenarioStatuses,
        findings,
        ...(repoGraph ? { repositoryGraph: repoGraph } : {}),
        evidenceIndex,
        limitations: [...new Set(limitations)],
        redactionComplete: true,
      };
      return redactExplorationBundle(bundle);
    };

    const persistCheckpoint = async (runtimeVerified: boolean) => {
      const snapshot = buildSnapshot(runtimeVerified);
      if (options.checkpointPath) {
        await saveExplorationContextBundle(options.checkpointPath, snapshot);
      }
      if (options.onCheckpoint) {
        await options.onCheckpoint(snapshot);
      }
    };

    // Source-only offline mode when no baseUrl is provided
    if (!options.baseUrl) {
      limitations.push('No baseUrl supplied; exploration ran in NOT_RUNTIME_VERIFIED source-only mode.');
      for (const sc of options.workflowPlan.scenarios) {
        scenarioStatuses.push({
          scenarioId: sc.id,
          status: 'NOT_VERIFIED',
          verificationLayers: {
            UI: 'NOT_VERIFIED',
            API: 'NOT_VERIFIED',
            CLIENT_RELOAD: 'NOT_VERIFIED',
            DB: 'NOT_APPLICABLE',
          },
          reason: 'No running application baseUrl supplied.',
          evidenceIds: [],
        });
      }
      const bundle = buildSnapshot(false);
      await persistCheckpoint(false);
      return bundle;
    }

    let browserToClose: any = null;
    let page = options.page;

    try {
      if (!page) {
        if (options.browser) {
          const context = await options.browser.newContext({
            ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
          });
          page = await context.newPage();
        } else {
          const { chromium } = await import('@playwright/test');
          browserToClose = await chromium.launch({ headless: true });
          const context = await browserToClose.newContext({
            ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
          });
          page = await context.newPage();
        }
      }

      const timeoutMs = options.timeoutMs ?? 15_000;
      let currentScenarioId: string | undefined;

      if (typeof page.on === 'function') {
        page.on('response', (res: any) => {
          try {
            const req = typeof res.request === 'function' ? res.request() : undefined;
            const evt: RawNetworkEvent = {
              url: typeof res.url === 'function' ? res.url() : '',
              method: req && typeof req.method === 'function' ? req.method() : 'GET',
              status: typeof res.status === 'function' ? res.status() : 200,
              resourceType: req && typeof req.resourceType === 'function' ? req.resourceType() : undefined,
              timestamp: Date.now(),
            };
            rawNetworkEvents.push(evt);
            const recId = `net-${networkRecords.length + 1}`;
            const isError = evt.status >= 400;
            networkRecords.push({
              id: recId,
              ...(currentScenarioId ? { scenarioId: currentScenarioId } : {}),
              method: evt.method,
              url: EvidenceRedactor.redactText(evt.url).redactedText,
              status: evt.status,
              isError,
              ...(evt.resourceType ? { resourceType: evt.resourceType } : {}),
              timestamp: new Date(evt.timestamp!).toISOString(),
            });
          } catch {}
        });
        page.on('pageerror', (err: any) => {
          consoleErrors.push(EvidenceRedactor.redactText(err?.message ?? String(err)).redactedText);
        });
        page.on('console', (msg: any) => {
          if (typeof msg.type === 'function' && msg.type() === 'error') {
            consoleErrors.push(EvidenceRedactor.redactText(typeof msg.text === 'function' ? msg.text() : String(msg)).redactedText);
          }
        });
      }

      // Optional controlled login (credentials NEVER placed in evidence)
      if (options.loginConfig) {
        await page.goto(options.loginConfig.loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (options.loginConfig.usernameSelector && options.loginConfig.username) {
          await page.locator(options.loginConfig.usernameSelector).fill(options.loginConfig.username);
        }
        if (options.loginConfig.passwordSelector && options.loginConfig.password) {
          await page.locator(options.loginConfig.passwordSelector).fill(options.loginConfig.password);
        }
        if (options.loginConfig.submitSelector) {
          await page.locator(options.loginConfig.submitSelector).click();
        }
        authenticated = true;
      }

      const allowDestructive = Boolean(
        options.allowDestructiveActions && (options.designatedTestEnvironment || isLocalhostUrl(options.baseUrl)),
      );
      const allowMutating = options.allowMutatingActions ?? isLocalhostUrl(options.baseUrl);
      let lastCreatedValue: string | undefined;

      // Multi-route discovery sweep: inspect same-origin links & static routes once before scenarios
      try {
        await page.goto(options.baseUrl, { waitUntil: 'networkidle', timeout: Math.min(timeoutMs, 6_000) }).catch(() =>
          page.goto(options.baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }),
        );
        const origin = new URL(options.baseUrl).origin;
        const linkHrefs: string[] = await page.$$eval('a[href]', (anchors: any[]) =>
          anchors.map((a) => String(a.getAttribute('href') || '')).filter(Boolean),
        ).catch(() => []);
        const candidateRoutes = new Set<string>([options.baseUrl]);
        for (const href of linkHrefs) {
          if (href.startsWith('#') || /^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
          if (/logout|signout|delete|destroy|remove/i.test(href)) continue;
          try {
            const resolved = new URL(href, options.baseUrl);
            if (resolved.origin === origin) candidateRoutes.add(resolved.href);
          } catch {}
        }
        for (const hintRoute of repoGraph?.sourceHints.routes ?? []) {
          if (!hintRoute.startsWith('/') || hintRoute.includes(':') || /logout|signout|delete/i.test(hintRoute)) continue;
          try {
            candidateRoutes.add(new URL(hintRoute, origin).href);
          } catch {}
        }
        const routesToSweep = [...candidateRoutes].slice(0, 5);
        for (const routeUrl of routesToSweep) {
          await page.goto(routeUrl, { waitUntil: 'networkidle', timeout: Math.min(timeoutMs, 4_000) }).catch(() =>
            page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }),
          );
          const sweepPathname = (() => {
            try {
              return new URL(page.url()).pathname || '/';
            } catch {
              return '/';
            }
          })();
          const sweepTitle = typeof page.title === 'function' ? await page.title().catch(() => undefined) : undefined;
          if (!routesMap.has(sweepPathname)) {
            routesMap.set(sweepPathname, {
              route: sweepPathname,
              ...(sweepTitle ? { title: sweepTitle } : {}),
              discoveredAt: new Date().toISOString(),
              locatorIds: [],
            });
          }
          const sweepControls = await collectInteractiveControls(page);
          for (const ctrl of sweepControls) {
            const built = buildLocatorPlanFromDom(ctrl);
            if (seenLocatorExpr.has(`${sweepPathname}::${built.expression}`)) continue;
            const ver = await LiveLocatorVerifier.verify(page, built.plan);
            const locId = `loc-${verifiedLocators.length + 1}`;
            seenLocatorExpr.add(`${sweepPathname}::${built.expression}`);
            verifiedLocators.push({
              id: locId,
              route: sweepPathname,
              strategy: built.strategy,
              expression: built.expression,
              ...(ctrl.role ? { role: ctrl.role } : {}),
              ...(ctrl.accessibleName ? { accessibleName: ctrl.accessibleName } : {}),
              ...(ctrl.label ? { label: ctrl.label } : {}),
              ...(ctrl.placeholder ? { placeholder: ctrl.placeholder } : {}),
              ...(ctrl.testId ? { testId: ctrl.testId } : {}),
              matchCount: ver.count,
              visible: ver.isVisible,
              enabled: ver.isEnabled,
              confidence: ver.isUnique ? 0.95 : 0.5,
              timestamp: new Date().toISOString(),
            });
            routesMap.get(sweepPathname)!.locatorIds.push(locId);
          }
        }
      } catch {
        // Ignore non-fatal route sweep errors; scenario loop continues directly on baseUrl
      }

      for (let scIdx = 0; scIdx < options.workflowPlan.scenarios.length; scIdx += 1) {
        const scenario = options.workflowPlan.scenarios[scIdx]!;
        currentScenarioId = scenario.id;

        if (options.simulateCrashAfterScenarioIndex !== undefined && scIdx >= options.simulateCrashAfterScenarioIndex) {
          throw new Error(`Simulated exploration interruption before scenario '${scenario.id}'`);
        }

        if (scenario.applicability === 'needs_clarification') {
          scenarioStatuses.push({
            scenarioId: scenario.id,
            status: 'NOT_VERIFIED',
            verificationLayers: { UI: 'NOT_VERIFIED', API: 'NOT_APPLICABLE', CLIENT_RELOAD: 'NOT_APPLICABLE', DB: 'NOT_APPLICABLE' },
            reason: 'Scenario marked needs_clarification in workflow plan.',
            evidenceIds: [],
          });
          continue;
        }

        const netStartIdx = networkRecords.length;
        const errStartIdx = consoleErrors.length;
        const scEvidenceIds: string[] = [];

        // Navigate to baseUrl for deterministic isolation (skip reload scenarios so state stays)
        if (scenario.category !== 'persistence') {
          await page.goto(options.baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        }

        const routePathname = (() => {
          try {
            return new URL(page.url()).pathname || '/';
          } catch {
            return '/';
          }
        })();
        const pageTitle = typeof page.title === 'function' ? await page.title().catch(() => undefined) : undefined;
        if (!routesMap.has(routePathname)) {
          routesMap.set(routePathname, {
            route: routePathname,
            ...(pageTitle ? { title: pageTitle } : {}),
            discoveredAt: new Date().toISOString(),
            locatorIds: [],
          });
        }

        const controls = await collectInteractiveControls(page);
        for (const ctrl of controls) {
          const built = buildLocatorPlanFromDom(ctrl);
          if (seenLocatorExpr.has(`${routePathname}::${built.expression}`)) continue;
          const ver = await LiveLocatorVerifier.verify(page, built.plan);
          const locId = `loc-${verifiedLocators.length + 1}`;
          seenLocatorExpr.add(`${routePathname}::${built.expression}`);
          verifiedLocators.push({
            id: locId,
            route: routePathname,
            strategy: built.strategy,
            expression: built.expression,
            ...(ctrl.role ? { role: ctrl.role } : {}),
            ...(ctrl.accessibleName ? { accessibleName: ctrl.accessibleName } : {}),
            ...(ctrl.label ? { label: ctrl.label } : {}),
            ...(ctrl.placeholder ? { placeholder: ctrl.placeholder } : {}),
            ...(ctrl.testId ? { testId: ctrl.testId } : {}),
            matchCount: ver.count,
            visible: ver.isVisible,
            enabled: ver.isEnabled,
            confidence: ver.isUnique ? 0.95 : 0.5,
            timestamp: new Date().toISOString(),
          });
          routesMap.get(routePathname)!.locatorIds.push(locId);
          scEvidenceIds.push(locId);
          evidenceIndex.push({
            id: locId,
            kind: 'verified-locator',
            source: 'playwright-live-dom',
            timestamp: new Date().toISOString(),
            confidence: ver.isUnique ? 0.95 : 0.5,
            scenarioIds: [scenario.id],
            description: `${built.expression} (count=${ver.count})`,
          });
        }

        // Check destructive action guard against scenario text
        const combinedScenarioText = `${scenario.title} ${scenario.steps.map((s) => s.text).join(' ')}`;
        if (DESTRUCTIVE_TEXT_RE.test(combinedScenarioText) && !allowDestructive) {
          actionRecords.push({
            id: `act-${actionRecords.length + 1}`,
            scenarioId: scenario.id,
            stepIndex: 0,
            action: 'destructive-policy-check',
            routeBefore: routePathname,
            routeAfter: routePathname,
            domBeforeSummary: '',
            domAfterSummary: '',
            domDiff: [],
            networkIds: [],
            consoleErrors: [],
            status: 'BLOCKED_BY_POLICY',
            timestamp: new Date().toISOString(),
          });
          scenarioStatuses.push({
            scenarioId: scenario.id,
            status: 'BLOCKED',
            verificationLayers: { UI: 'NOT_VERIFIED', API: 'NOT_VERIFIED', CLIENT_RELOAD: 'NOT_APPLICABLE', DB: 'NOT_APPLICABLE' },
            reason: 'Destructive operation blocked by safety policy (requires designatedTestEnvironment & allowDestructiveActions).',
            evidenceIds: scEvidenceIds,
          });
          await persistCheckpoint(true);
          continue;
        }

        const beforeSnap = await captureVisibleTextSnapshot(page);
        let uiStatus: VerificationLayerStatus = 'NOT_VERIFIED';
        let clientReloadStatus: VerificationLayerStatus = 'NOT_APPLICABLE';

        const textInputLoc = verifiedLocators.find(
          (l) => l.route === routePathname && (l.strategy === 'placeholder' || l.role === 'textbox') && l.visible && l.matchCount === 1,
        );
        const submitBtnLoc = verifiedLocators.find(
          (l) => l.route === routePathname && l.role === 'button' && !/delete|remove|cancel|close/i.test(l.accessibleName ?? '') && l.visible && l.matchCount >= 1,
        );

        const resolveLive = (loc: VerifiedLocatorEvidence) => {
          if (loc.testId) return page.getByTestId(loc.testId);
          if (loc.placeholder) return page.getByPlaceholder(loc.placeholder);
          if (loc.label) return page.getByLabel(loc.label);
          if (loc.role && loc.accessibleName) return page.getByRole(loc.role, { name: loc.accessibleName });
          return page.locator(loc.expression);
        };

        try {
          if (scenario.category === 'persistence') {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
            const afterReload = await captureVisibleTextSnapshot(page);
            const preserved = lastCreatedValue ? afterReload.summary.includes(lastCreatedValue) : afterReload.lines.length > 0;
            clientReloadStatus = preserved ? 'PASS' : 'FAIL';
            uiStatus = preserved ? 'PASS' : 'FAIL';
            const actId = `act-${actionRecords.length + 1}`;
            actionRecords.push({
              id: actId,
              scenarioId: scenario.id,
              stepIndex: 0,
              action: 'reload',
              routeBefore: routePathname,
              routeAfter: routePathname,
              domBeforeSummary: beforeSnap.summary,
              domAfterSummary: afterReload.summary,
              domDiff: diffLines(beforeSnap.lines, afterReload.lines),
              networkIds: networkRecords.slice(netStartIdx).map((n) => n.id),
              consoleErrors: consoleErrors.slice(errStartIdx),
              status: 'EXECUTED',
              timestamp: new Date().toISOString(),
            });
            scEvidenceIds.push(actId);
            persistenceObservations.push({
              scenarioId: scenario.id,
              clientReloadPreserved: preserved,
              dbStatus: 'NOT_VERIFIED',
              note: 'page.reload() verifies client/re-fetched state only; does not independently prove backend database persistence.',
            });
          } else if ((scenario.category === 'validation' || scenario.category === 'negative' || scenario.category === 'required-fields') && submitBtnLoc && textInputLoc) {
            const inputHandle = resolveLive(textInputLoc).first();
            const btnHandle = resolveLive(submitBtnLoc).first();
            await inputHandle.fill('');
            await btnHandle.click();
            await page.waitForTimeout(150);
            const afterInvalid = await captureVisibleTextSnapshot(page);
            const diff = diffLines(beforeSnap.lines, afterInvalid.lines);
            const actId = `act-${actionRecords.length + 1}`;
            actionRecords.push({
              id: actId,
              scenarioId: scenario.id,
              stepIndex: 0,
              action: 'submit-empty-validation',
              targetLocatorId: submitBtnLoc.id,
              targetExpression: submitBtnLoc.expression,
              valueRedacted: '',
              routeBefore: routePathname,
              routeAfter: routePathname,
              domBeforeSummary: beforeSnap.summary,
              domAfterSummary: afterInvalid.summary,
              domDiff: diff,
              networkIds: networkRecords.slice(netStartIdx).map((n) => n.id),
              consoleErrors: consoleErrors.slice(errStartIdx),
              status: 'EXECUTED',
              timestamp: new Date().toISOString(),
            });
            scEvidenceIds.push(actId);
            // If no explicit rejection/error failed, record observed behavior or PASS if unchanged / error displayed
            const explicitRejectAc = scenario.expectedOutcomes.some((o) => /\b(reject|prevent|error|remain|not create|ignored)\b/i.test(o));
            const createdSomethingInvalid = diff.some((d) => d.startsWith('+ ') && !/error|invalid|required/i.test(d));
            if (explicitRejectAc && createdSomethingInvalid) {
              uiStatus = 'FAIL';
              findings.push({
                id: `find-${findings.length + 1}`,
                category: 'SPEC_VIOLATION',
                scenarioId: scenario.id,
                evidenceIds: [actId],
                expectedSource: scenario.requirementRefs.join(', '),
                expectedBehavior: scenario.expectedOutcomes.join('; '),
                actualBehavior: `Invalid/empty submission produced unexpected additions: ${diff.slice(0, 3).join('; ')}`,
                confidence: 0.85,
                severity: 'high',
              });
            } else {
              uiStatus = 'PASS';
              findings.push({
                id: `find-${findings.length + 1}`,
                category: 'OBSERVED_BEHAVIOR',
                scenarioId: scenario.id,
                evidenceIds: [actId],
                actualBehavior: diff.length === 0 ? 'Empty submission produced no DOM mutation.' : `Observed DOM diff: ${diff.slice(0, 3).join('; ')}`,
                confidence: 0.85,
                severity: 'info',
              });
            }
          } else if (textInputLoc && allowMutating) {
            const sampleValue = `PIE Verify ${scenario.id.slice(0, 12)}`;
            lastCreatedValue = sampleValue;
            const inputHandle = resolveLive(textInputLoc).first();
            await inputHandle.fill(sampleValue);
            if (submitBtnLoc) {
              await resolveLive(submitBtnLoc).first().click();
            } else {
              await inputHandle.press('Enter');
            }
            await page.waitForTimeout(200);
            const afterSnap = await captureVisibleTextSnapshot(page);
            const diff = diffLines(beforeSnap.lines, afterSnap.lines);
            const actId = `act-${actionRecords.length + 1}`;
            actionRecords.push({
              id: actId,
              scenarioId: scenario.id,
              stepIndex: 0,
              action: submitBtnLoc ? 'fill-and-click' : 'fill-and-enter',
              targetLocatorId: textInputLoc.id,
              targetExpression: textInputLoc.expression,
              valueRedacted: sampleValue,
              routeBefore: routePathname,
              routeAfter: (() => {
                try {
                  return new URL(page.url()).pathname || routePathname;
                } catch {
                  return routePathname;
                }
              })(),
              domBeforeSummary: beforeSnap.summary,
              domAfterSummary: afterSnap.summary,
              domDiff: diff,
              networkIds: networkRecords.slice(netStartIdx).map((n) => n.id),
              consoleErrors: consoleErrors.slice(errStartIdx),
              status: 'EXECUTED',
              timestamp: new Date().toISOString(),
            });
            scEvidenceIds.push(actId);
            uiStatus = afterSnap.summary.includes(sampleValue) ? 'PASS' : (diff.length > 0 ? 'PASS' : 'FAIL');
            if (uiStatus === 'FAIL' && scenario.provenance === 'explicit-requirement') {
              findings.push({
                id: `find-${findings.length + 1}`,
                category: 'SPEC_VIOLATION',
                scenarioId: scenario.id,
                evidenceIds: [actId],
                expectedSource: scenario.requirementRefs.join(', '),
                expectedBehavior: scenario.expectedOutcomes.join('; '),
                actualBehavior: `Submitted "${sampleValue}" but expected UI change was not observed.`,
                confidence: 0.8,
                severity: 'high',
              });
            }
          } else {
            uiStatus = verifiedLocators.some((l) => l.route === routePathname) ? 'OBSERVED_BEHAVIOR' as any : 'NOT_VERIFIED';
            uiStatus = 'NOT_VERIFIED';
            findings.push({
              id: `find-${findings.length + 1}`,
              category: 'OBSERVED_BEHAVIOR',
              scenarioId: scenario.id,
              evidenceIds: scEvidenceIds,
              actualBehavior: `Inspected route ${routePathname}; discovered ${verifiedLocators.filter((l) => l.route === routePathname).length} visible control(s) without mutating execution.`,
              confidence: 0.7,
              severity: 'info',
            });
          }
        } catch (stepError: any) {
          uiStatus = 'FAIL';
          findings.push({
            id: `find-${findings.length + 1}`,
            category: 'AUTOMATION_GAP',
            scenarioId: scenario.id,
            evidenceIds: scEvidenceIds,
            actualBehavior: `Explorer step error: ${stepError?.message ?? String(stepError)}`,
            confidence: 0.75,
            severity: 'medium',
          });
        }

        const scenarioNetwork = networkRecords.slice(netStartIdx);
        const scenarioErrors = consoleErrors.slice(errStartIdx);
        const server5xx = scenarioNetwork.filter((n) => n.status >= 500);
        if (server5xx.length > 0 || scenarioErrors.length > 0) {
          findings.push({
            id: `find-${findings.length + 1}`,
            category: 'RUNTIME_ERROR',
            scenarioId: scenario.id,
            evidenceIds: [...scEvidenceIds, ...server5xx.map((n) => n.id)],
            actualBehavior: server5xx.length > 0
              ? `HTTP 5xx observed: ${server5xx.map((n) => `${n.method} ${n.url} -> ${n.status}`).join(', ')}`
              : `Runtime console/page error: ${scenarioErrors[0]}`,
            confidence: 0.95,
            severity: 'critical',
          });
        }

        const apiStatus: VerificationLayerStatus = scenarioNetwork.length === 0
          ? 'NOT_APPLICABLE'
          : server5xx.length > 0
            ? 'FAIL'
            : scenarioNetwork.some((n) => n.isError)
              ? (scenario.category === 'validation' || scenario.category === 'negative' ? 'PASS' : 'FAIL')
              : 'PASS';

        let dbStatus: VerificationLayerStatus = 'NOT_APPLICABLE';
        if (options.dbVerifier) {
          try {
            const dbRes = await options.dbVerifier(scenario, actionRecords.filter((a) => a.scenarioId === scenario.id));
            dbStatus = dbRes.status;
          } catch {
            dbStatus = 'NOT_VERIFIED';
          }
        }

        const hasDefect = findings.some(
          (f) => f.scenarioId === scenario.id && (f.category === 'SPEC_VIOLATION' || f.category === 'RUNTIME_ERROR'),
        );
        const finalStatus: ScenarioExplorationStatus['status'] = hasDefect
          ? 'DEFECT_DETECTED'
          : uiStatus === 'PASS'
            ? 'VERIFIED'
            : 'NOT_VERIFIED';

        scenarioStatuses.push({
          scenarioId: scenario.id,
          status: finalStatus,
          verificationLayers: {
            UI: uiStatus,
            API: apiStatus,
            CLIENT_RELOAD: clientReloadStatus,
            DB: dbStatus,
          },
          evidenceIds: scEvidenceIds,
        });

        await persistCheckpoint(true);
      }

      if (rawNetworkEvents.length > 0) {
        await networkCollector.collect({ events: rawNetworkEvents });
      }
    } catch (error: any) {
      limitations.push(`Browser exploration ended early: ${error?.message ?? String(error)}`);
      await persistCheckpoint(actionRecords.length > 0 || verifiedLocators.length > 0);
    } finally {
      if (browserToClose) {
        await browserToClose.close().catch(() => {});
      }
    }

    const finalBundle = buildSnapshot(actionRecords.length > 0 || verifiedLocators.length > 0);
    if (options.checkpointPath) {
      await saveExplorationContextBundle(options.checkpointPath, finalBundle);
    }
    return finalBundle;
  }

  public static async resumeFromCheckpoint(checkpointPath: string): Promise<ExplorationContextBundle> {
    const resolved = path.resolve(checkpointPath);
    await fs.access(resolved);
    return loadExplorationContextBundle(resolved);
  }
}
