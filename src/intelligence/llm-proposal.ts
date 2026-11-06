import { z } from 'zod';
import { RepairOperation, RepairOperationSchema, validateRepairOperation } from '../repair/repair-operations.js';

export const EvidenceBundleSchema = z.object({
  bundleId: z.string().min(1),
  executionId: z.string().min(1),
  testIdentity: z.string().min(1),
  failedActionId: z.string().optional(),
  failureCategory: z.string().optional(),
  sourceContext: z.array(z.object({
    filePath: z.string(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    content: z.string(),
  })).default([]),
  artifacts: z.array(z.object({
    kind: z.enum(['trace', 'screenshot', 'dom', 'aria', 'network', 'console', 'video', 'git-diff']),
    reference: z.string(),
    redacted: z.boolean(),
  })).default([]),
  diagnostic: z.object({
    playwrightVersion: z.string(),
    traceFormatVersion: z.number(),
    failedAction: z.object({
      callId: z.string(),
      action: z.string(),
      selector: z.string().optional(),
      sourceFile: z.string().optional(),
      line: z.number().optional(),
      column: z.number().optional(),
      errorMessage: z.string().optional(),
      errorStack: z.string().optional(),
      durationMs: z.number().optional(),
      logs: z.array(z.string()).optional(),
    }),
    snapshots: z.object({
      before: z.string().optional(),
      action: z.string().optional(),
      after: z.string().optional(),
    }),
    networkEvents: z.array(z.object({
      method: z.string(),
      url: z.string(),
      status: z.number(),
      statusText: z.string().optional(),
      errorText: z.string().optional(),
    })),
    consoleEvents: z.array(z.object({ type: z.string(), text: z.string() })),
    evidenceCompleteness: z.object({
      domAvailable: z.boolean(),
      networkAvailable: z.boolean(),
      sourceAvailable: z.boolean(),
    }),
  }).optional(),
  redactionComplete: z.boolean(),
  limitations: z.array(z.string()).default([]),
}).strict();

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const LlmRepairProposalSchema = z.object({
  proposalVersion: z.literal('1'),
  decision: z.enum(['PROPOSE', 'ABSTAIN']),
  failureKind: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string().min(1),
  operations: z.array(RepairOperationSchema).max(20),
  requiredVerification: z.array(z.string()).min(1),
  evidenceReferences: z.array(z.string()),
}).strict();

export type LlmRepairProposal = z.infer<typeof LlmRepairProposalSchema>;

export interface ProposalParseResult {
  isValid: boolean;
  proposal?: LlmRepairProposal;
  errors: string[];
}

export function parseLlmRepairProposal(input: unknown): ProposalParseResult {
  let candidate: unknown = input;
  if (typeof input === 'string') {
    try {
      candidate = JSON.parse(input);
    } catch (error) {
      return { isValid: false, errors: [`Proposal is not valid JSON: ${String(error)}`] };
    }
  }

  const parsed = LlmRepairProposalSchema.safeParse(candidate);
  if (!parsed.success) {
    return { isValid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const operationErrors = parsed.data.operations.flatMap((operation) => {
    const result = validateRepairOperation(operation);
    return result.isValid ? [] : [result.reason ?? 'Invalid repair operation'];
  });
  if (operationErrors.length > 0) return { isValid: false, errors: operationErrors };

  if (parsed.data.decision === 'ABSTAIN' && parsed.data.operations.some((operation) => operation.kind !== 'abstain')) {
    return { isValid: false, errors: ['ABSTAIN proposals cannot contain source mutation operations'] };
  }

  return { isValid: true, proposal: parsed.data, errors: [] };
}

export function proposalOperations(proposal: LlmRepairProposal): RepairOperation[] {
  return proposal.operations;
}

