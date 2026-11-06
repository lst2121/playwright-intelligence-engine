import { LocatorPlan } from '../selector/candidate-extractor.js';
import { LiveLocatorVerifier, LiveVerificationResult } from '../selector/live-locator-verifier.js';
import { RepairOperation, validateRepairOperation } from './repair-operations.js';
import { compileSafeRepairOperation } from './safe-operation-compiler.js';

export type BrowserOperationStatus = 'VERIFIED' | 'FAILED' | 'ABSTAINED';

export interface BrowserOperationExecutionInput {
  pageOrFrame: any;
  operation: unknown;
  targetPlan?: LocatorPlan | undefined;
  replacementPlan?: LocatorPlan | undefined;
  overlayPlan?: LocatorPlan | undefined;
  allowInteraction?: boolean | undefined;
}

export interface BrowserOperationExecutionResult {
  status: BrowserOperationStatus;
  kind: RepairOperation['kind'];
  action: 'verify' | 'click' | 'none';
  verification?: LiveVerificationResult | undefined;
  evidence: string[];
  reason?: string | undefined;
}

function failed(kind: RepairOperation['kind'], action: BrowserOperationExecutionResult['action'], reason: string): BrowserOperationExecutionResult {
  return { status: 'FAILED', kind, action, evidence: [], reason };
}

function abstained(kind: RepairOperation['kind'], reason: string): BrowserOperationExecutionResult {
  return { status: 'ABSTAINED', kind, action: 'none', evidence: [], reason };
}

async function verifyPlan(pageOrFrame: any, kind: RepairOperation['kind'], plan: LocatorPlan, label: string): Promise<BrowserOperationExecutionResult> {
  const verification = await LiveLocatorVerifier.verify(pageOrFrame, plan);
  if (!verification.isUnique || !verification.isVisible || !verification.isEnabled) {
    return {
      status: 'FAILED',
      kind,
      action: 'verify',
      verification,
      evidence: [`${label} locator: ${verification.expression}`, `Matches: ${verification.count}`, `Visible: ${verification.isVisible}`, `Enabled: ${verification.isEnabled}`],
      reason: verification.reason ?? `${label} locator is not unique and actionable`,
    };
  }
  return {
    status: 'VERIFIED',
    kind,
    action: 'verify',
    verification,
    evidence: [`${label} locator verified uniquely and actionable`, `Expression: ${verification.expression}`],
  };
}

async function executeStableWaitOperation(
  pageOrFrame: any,
  operation: RepairOperation & { kind: 'replace_unstable_wait_with_state_wait' },
  targetPlan: LocatorPlan | undefined,
): Promise<BrowserOperationExecutionResult> {
  const supportedStates = new Set(['domcontentloaded', 'load', 'networkidle']);
  const supportedSteps = new Set(['target_visible', 'target_enabled']);
  const steps = operation.steps ?? [];

  if (
    steps.length === 0 ||
    steps.some((step) =>
      (step.startsWith('load_state:') && !supportedStates.has(step.slice('load_state:'.length))) ||
      (!step.startsWith('load_state:') && !supportedSteps.has(step)),
    )
  ) {
    return abstained(
      operation.kind,
      'Only load_state:domcontentloaded, load_state:load, load_state:networkidle, target_visible, and target_enabled steps are executable',
    );
  }

  const requiresTarget = steps.some((step) => supportedSteps.has(step));
  if (requiresTarget && !targetPlan) {
    return abstained(operation.kind, 'A typed targetPlan is required for target state waits');
  }

  const evidence: string[] = [];
  try {
    for (const step of steps) {
      if (step.startsWith('load_state:')) {
        const state = step.slice('load_state:'.length);
        if (typeof pageOrFrame.waitForLoadState !== 'function') {
          return failed(operation.kind, 'verify', 'Page does not expose waitForLoadState()');
        }
        await pageOrFrame.waitForLoadState(state);
        evidence.push(`Load state reached: ${state}`);
        continue;
      }

      const locator = LiveLocatorVerifier.locate(pageOrFrame, targetPlan!);
      if (typeof locator.waitFor === 'function') {
        await locator.waitFor({ state: 'visible', timeout: 5000 });
      }
      const verification = await LiveLocatorVerifier.verify(pageOrFrame, targetPlan!);
      if (!verification.isUnique || !verification.isVisible || (step === 'target_enabled' && !verification.isEnabled)) {
        return {
          status: 'FAILED',
          kind: operation.kind,
          action: 'verify',
          verification,
          evidence,
          reason: verification.reason ?? `Target did not satisfy ${step}`,
        };
      }
      evidence.push(`Target state verified: ${step}`);
    }

    return { status: 'VERIFIED', kind: operation.kind, action: 'verify', evidence };
  } catch (error) {
    return failed(operation.kind, 'verify', `State wait failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeComboboxFlowOperation(
  pageOrFrame: any,
  operation: RepairOperation & { kind: 'replace_select_with_combobox_flow' },
  targetPlan: LocatorPlan | undefined,
  allowInteraction: boolean | undefined,
): Promise<BrowserOperationExecutionResult> {
  const steps = operation.steps ?? [];
  const supportedSteps = new Set(['target_visible', 'target_enabled', 'open']);
  const optionSteps = steps.filter((step) => step.startsWith('option:'));
  const invalid = steps.some((step) => !supportedSteps.has(step) && !step.startsWith('option:'));
  if (steps.length === 0 || invalid || optionSteps.some((step) => step.slice('option:'.length).trim().length === 0)) {
    return abstained(
      operation.kind,
      'Combobox flows allow only target_visible, target_enabled, open, and option:<visible label> steps',
    );
  }
  if (!targetPlan) return abstained(operation.kind, 'A typed targetPlan is required for combobox verification');

  const hasInteraction = steps.some((step) => step === 'open' || step.startsWith('option:'));
  if (hasInteraction && allowInteraction !== true) {
    return abstained(operation.kind, 'Combobox interaction requires explicit allowInteraction: true');
  }

  const targetVerification = await LiveLocatorVerifier.verify(pageOrFrame, targetPlan);
  if (!targetVerification.isUnique || !targetVerification.isVisible || !targetVerification.isEnabled) {
    return {
      status: 'FAILED',
      kind: operation.kind,
      action: 'verify',
      verification: targetVerification,
      evidence: [`Combobox target: ${targetVerification.expression}`, `Matches: ${targetVerification.count}`],
      reason: targetVerification.reason ?? 'Combobox target is not unique and actionable',
    };
  }

  const evidence = [`Combobox target verified: ${targetVerification.expression}`];
  const target = LiveLocatorVerifier.locate(pageOrFrame, targetPlan);
  for (const step of steps) {
    if (step === 'target_visible' || step === 'target_enabled') {
      evidence.push(`Combobox target state verified: ${step}`);
      continue;
    }
    if (step === 'open') {
      await target.click();
      evidence.push('Combobox opened');
      continue;
    }
    const label = step.slice('option:'.length).trim();
    const optionPlan: LocatorPlan = { kind: 'getByRole', role: 'option', options: { name: label, exact: true } };
    const optionVerification = await verifyPlan(pageOrFrame, operation.kind, optionPlan, `Combobox option '${label}'`);
    if (optionVerification.status !== 'VERIFIED') return optionVerification;
    await LiveLocatorVerifier.locate(pageOrFrame, optionPlan).click();
    evidence.push(`Combobox option selected: ${label}`);
  }

  return { status: 'VERIFIED', kind: operation.kind, action: hasInteraction ? 'click' : 'verify', evidence };
}

/**
 * Executes only the browser-safe subset of allowlisted repair operations.
 * It accepts typed LocatorPlans rather than evaluating model-generated strings.
 * Source mutation remains a separate AST/worktree/approval lifecycle.
 */
export async function executeBrowserOperation(input: BrowserOperationExecutionInput): Promise<BrowserOperationExecutionResult> {
  const validation = validateRepairOperation(input.operation);
  if (!validation.isValid || !validation.operation) {
    return abstained('abstain', validation.reason ?? 'Invalid repair operation');
  }
  const operation = validation.operation;
  if (!input.pageOrFrame) return failed(operation.kind, 'none', 'A live Page or Frame instance is required');
  if (operation.kind === 'abstain') return abstained(operation.kind, operation.reason ?? 'Proposal requested abstention');

  if (operation.kind === 'replace_locator') {
    if (!input.replacementPlan) return abstained(operation.kind, 'A typed replacementPlan is required for browser verification');
    return verifyPlan(input.pageOrFrame, operation.kind, input.replacementPlan, 'Replacement');
  }

  if (operation.kind === 'add_frame_scope') {
    if (!input.targetPlan) return abstained(operation.kind, 'A typed targetPlan is required for frame verification');
    const compiled = compileSafeRepairOperation(operation);
    if (compiled.readiness !== 'READY_FOR_ISOLATED_VERIFICATION') return abstained(operation.kind, compiled.reason);
    if (typeof input.pageOrFrame.frameLocator !== 'function') return failed(operation.kind, 'verify', 'Page does not expose frameLocator()');
    const frame = input.pageOrFrame.frameLocator(operation.frameLocator!);
    return verifyPlan(frame, operation.kind, input.targetPlan, 'Frame target');
  }

  if (operation.kind === 'add_shadow_scope') {
    const compiled = compileSafeRepairOperation(operation);
    if (compiled.readiness !== 'READY_FOR_ISOLATED_VERIFICATION') return abstained(operation.kind, compiled.reason);
    if (typeof input.pageOrFrame.locator !== 'function') return failed(operation.kind, 'verify', 'Page does not expose locator()');
    let scoped = input.pageOrFrame;
    for (const selector of operation.shadowPath!) scoped = scoped.locator(selector);
    const verification = await LiveLocatorVerifier.verify(scoped, { kind: 'locator', selector: '*' });
    if (!verification.isUnique || !verification.isVisible || !verification.isEnabled) {
      return {
        status: 'FAILED',
        kind: operation.kind,
        action: 'verify',
        verification,
        evidence: [`Shadow path: ${operation.shadowPath!.join(' > ')}`, `Matches: ${verification.count}`],
        reason: verification.reason ?? 'Shadow-scoped target is not unique and actionable',
      };
    }
    return {
      status: 'VERIFIED',
      kind: operation.kind,
      action: 'verify',
      verification,
      evidence: [`Shadow path verified: ${operation.shadowPath!.join(' > ')}`],
    };
  }

  if (operation.kind === 'dismiss_overlay') {
    if (!input.overlayPlan) return abstained(operation.kind, 'A typed overlayPlan is required for browser execution');
    if (input.allowInteraction !== true) return abstained(operation.kind, 'Overlay interaction requires explicit allowInteraction: true');
    const verification = await verifyPlan(input.pageOrFrame, operation.kind, input.overlayPlan, 'Overlay');
    if (verification.status !== 'VERIFIED' || !verification.verification) return verification;
    const locator = LiveLocatorVerifier.locate(input.pageOrFrame, input.overlayPlan);
    try {
      await locator.click();
      return { ...verification, action: 'click', evidence: [...verification.evidence, 'Overlay dismissal click completed'] };
    } catch (error) {
      return failed(operation.kind, 'click', `Overlay dismissal failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (operation.kind === 'replace_unstable_wait_with_state_wait') {
    return executeStableWaitOperation(
      input.pageOrFrame,
      operation as RepairOperation & { kind: 'replace_unstable_wait_with_state_wait' },
      input.targetPlan,
    );
  }

  if (operation.kind === 'replace_select_with_combobox_flow') {
    return executeComboboxFlowOperation(
      input.pageOrFrame,
      operation as RepairOperation & { kind: 'replace_select_with_combobox_flow' },
      input.targetPlan,
      input.allowInteraction,
    );
  }

  return abstained(operation.kind, `Operation '${operation.kind}' remains proposal-only until its business semantics are explicitly modeled`);
}
