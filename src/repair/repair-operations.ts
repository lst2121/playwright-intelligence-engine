import { z } from 'zod';

export const RepairOperationKindSchema = z.enum([
  'replace_locator',
  'add_frame_scope',
  'add_shadow_scope',
  'dismiss_overlay',
  'satisfy_prerequisite',
  'replace_select_with_combobox_flow',
  'replace_unstable_wait_with_state_wait',
  'abstain',
]);

export type RepairOperationKind = z.infer<typeof RepairOperationKindSchema>;

export const RepairOperationSchema = z.object({
  kind: RepairOperationKindSchema,
  target: z.string().min(1).optional(),
  locator: z.string().min(1).optional(),
  frameLocator: z.string().min(1).optional(),
  shadowPath: z.array(z.string().min(1)).min(1).optional(),
  prerequisite: z.string().min(1).optional(),
  steps: z.array(z.string().min(1)).min(1).optional(),
  reason: z.string().min(1).optional(),
}).strict();

export type RepairOperation = z.infer<typeof RepairOperationSchema>;

export interface RepairOperationValidation {
  isValid: boolean;
  reason?: string;
  operation?: RepairOperation;
}

const requiredFields: Partial<Record<RepairOperationKind, Array<keyof RepairOperation>>> = {
  replace_locator: ['target', 'locator'],
  add_frame_scope: ['target', 'frameLocator'],
  add_shadow_scope: ['target', 'shadowPath'],
  dismiss_overlay: ['locator'],
  satisfy_prerequisite: ['prerequisite'],
  replace_select_with_combobox_flow: ['target', 'steps'],
  replace_unstable_wait_with_state_wait: ['target', 'steps'],
  abstain: ['reason'],
};

export function validateRepairOperation(input: unknown): RepairOperationValidation {
  const parsed = RepairOperationSchema.safeParse(input);
  if (!parsed.success) {
    return { isValid: false, reason: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }

  const operation = parsed.data;
  const required = requiredFields[operation.kind] ?? [];
  const missing = required.filter((field) => operation[field] === undefined);
  if (missing.length > 0) {
    return { isValid: false, reason: `Operation '${operation.kind}' is missing: ${missing.join(', ')}` };
  }

  return { isValid: true, operation };
}

export function isSourceMutationOperation(operation: RepairOperation): boolean {
  return operation.kind !== 'abstain';
}

