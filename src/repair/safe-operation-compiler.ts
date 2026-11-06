import { DiffAllowlistValidator } from './diff-allowlist.js';
import { RepairOperation, validateRepairOperation } from './repair-operations.js';

export type SafeOperationReadiness = 'READY_FOR_ISOLATED_VERIFICATION' | 'PROPOSAL_ONLY' | 'ABSTAIN';

export interface CompiledSafeOperation {
  readiness: SafeOperationReadiness;
  kind: RepairOperation['kind'];
  target?: string | undefined;
  replacementLocator?: string | undefined;
  reason: string;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function composeFrameScope(target: string, frameLocator: string): string | undefined {
  const rootMatch = target.match(/^(this\.page|page)\.(.+)$/);
  if (!rootMatch) return undefined;
  return `${rootMatch[1]}.frameLocator(${quote(frameLocator)}).${rootMatch[2]}`;
}

function composeShadowScope(target: string, shadowPath: string[]): string {
  return shadowPath.reduce((expression, selector) => `${expression}.locator(${quote(selector)})`, target);
}

/**
 * Converts allowlisted workflow operations into immutable locator proposals.
 * It never writes source files and never claims browser execution succeeded.
 */
export function compileSafeRepairOperation(input: unknown): CompiledSafeOperation {
  const validation = validateRepairOperation(input);
  if (!validation.isValid || !validation.operation) {
    return { readiness: 'ABSTAIN', kind: 'abstain', reason: validation.reason ?? 'Invalid repair operation' };
  }

  const operation = validation.operation;
  if (operation.kind === 'abstain') {
    return { readiness: 'ABSTAIN', kind: operation.kind, reason: operation.reason ?? 'Proposal requested abstention' };
  }

  let replacementLocator: string | undefined;
  if (operation.kind === 'replace_locator') replacementLocator = operation.locator;
  if (operation.kind === 'add_frame_scope') replacementLocator = composeFrameScope(operation.target!, operation.frameLocator!);
  if (operation.kind === 'add_shadow_scope') replacementLocator = composeShadowScope(operation.target!, operation.shadowPath!);

  if (replacementLocator) {
    const grammar = DiffAllowlistValidator.validateLocatorGrammar(replacementLocator);
    if (!grammar.isValid) {
      return { readiness: 'ABSTAIN', kind: operation.kind, target: operation.target, replacementLocator, reason: grammar.reason ?? 'Locator grammar rejected' };
    }
    return {
      readiness: 'READY_FOR_ISOLATED_VERIFICATION',
      kind: operation.kind,
      target: operation.target,
      replacementLocator,
      reason: 'Static locator transformation passed the PIE allowlist and requires isolated browser verification',
    };
  }

  return {
    readiness: 'PROPOSAL_ONLY',
    kind: operation.kind,
    target: operation.target,
    reason: `Operation '${operation.kind}' requires a dedicated browser-aware executor and remains proposal-only`,
  };
}
