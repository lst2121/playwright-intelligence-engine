import { DiffAllowlistValidator } from './diff-allowlist.js';
import { RepairOperation, validateRepairOperation } from './repair-operations.js';

export type WorkflowPlanStep =
  | { kind: 'replace_locator'; target: string; locator: string }
  | { kind: 'add_frame_scope'; target: string; frameLocator: string }
  | { kind: 'add_shadow_scope'; target: string; shadowPath: string[] }
  | { kind: 'dismiss_overlay'; locator: string }
  | { kind: 'satisfy_prerequisite'; prerequisite: string }
  | { kind: 'replace_select_with_combobox_flow'; target: string; steps: string[] }
  | { kind: 'replace_unstable_wait_with_state_wait'; target: string; steps: string[] };

export interface WorkflowPlan {
  status: 'EXECUTABLE' | 'ABSTAIN';
  steps: WorkflowPlanStep[];
  errors: string[];
}

export function compileWorkflowPlan(operations: RepairOperation[]): WorkflowPlan {
  const errors: string[] = [];
  const steps: WorkflowPlanStep[] = [];

  for (const operation of operations) {
    const validation = validateRepairOperation(operation);
    if (!validation.isValid || !validation.operation) {
      errors.push(validation.reason ?? 'Invalid repair operation');
      continue;
    }

    const valid = validation.operation;
    if (valid.kind === 'abstain') {
      if (operations.length !== 1) errors.push('An abstention must be the only operation in a workflow plan');
      continue;
    }

    if (valid.kind === 'replace_locator') {
      const grammar = DiffAllowlistValidator.validateLocatorGrammar(valid.locator!);
      if (!grammar.isValid) errors.push(grammar.reason ?? 'Locator grammar rejected');
      else steps.push({ kind: valid.kind, target: valid.target!, locator: valid.locator! });
    } else if (valid.kind === 'add_frame_scope') {
      steps.push({ kind: valid.kind, target: valid.target!, frameLocator: valid.frameLocator! });
    } else if (valid.kind === 'add_shadow_scope') {
      steps.push({ kind: valid.kind, target: valid.target!, shadowPath: valid.shadowPath! });
    } else if (valid.kind === 'dismiss_overlay') {
      steps.push({ kind: valid.kind, locator: valid.locator! });
    } else if (valid.kind === 'satisfy_prerequisite') {
      steps.push({ kind: valid.kind, prerequisite: valid.prerequisite! });
    } else if (valid.kind === 'replace_select_with_combobox_flow') {
      steps.push({ kind: valid.kind, target: valid.target!, steps: valid.steps! });
    } else if (valid.kind === 'replace_unstable_wait_with_state_wait') {
      steps.push({ kind: valid.kind, target: valid.target!, steps: valid.steps! });
    }
  }

  if (errors.length > 0) return { status: 'ABSTAIN', steps: [], errors };
  if (operations.some((operation) => operation.kind === 'abstain')) return { status: 'ABSTAIN', steps: [], errors: ['Proposal requested abstention'] };
  return { status: 'EXECUTABLE', steps, errors: [] };
}

