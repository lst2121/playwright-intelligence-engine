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

export const AgentActionKindSchema = z.enum([
  'inspect_evidence',
  'discover_source_mapping',
  'rank_locator_candidates',
  'build_repair_proposal',
  'verify_repair',
  'abstain',
]);

export type AgentActionKind = z.infer<typeof AgentActionKindSchema>;

export const AgentActionSchema = z.object({
  kind: AgentActionKindSchema,
  selector: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  locator: z.string().min(1).optional(),
  sourceFile: z.string().min(1).optional(),
  className: z.string().min(1).optional(),
  memberName: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
}).strict();

export type AgentAction = z.infer<typeof AgentActionSchema>;

const AgentClassificationSchema = z.object({
  category: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

const AgentStepResponseSchema = z.object({
  protocolVersion: z.literal('2'),
  responseType: z.literal('STEP'),
  status: z.literal('CONTINUE'),
  decision: z.enum([
    'INSPECT_EVIDENCE',
    'DISCOVER_SOURCE_MAPPING',
    'RANK_LOCATOR_CANDIDATES',
    'BUILD_REPAIR_PROPOSAL',
    'VERIFY_REPAIR',
    'ABSTAIN',
  ]),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string().min(1),
  evidenceReferences: z.array(z.string()),
  action: AgentActionSchema,
  requiredObservation: z.string().min(1),
}).strict();

const AgentFinalResponseSchema = z.object({
  protocolVersion: z.literal('2'),
  responseType: z.literal('FINAL'),
  status: z.enum(['PROPOSAL_READY', 'VERIFIED_READY_FOR_APPROVAL', 'ABSTAIN', 'BLOCKED', 'REJECTED']),
  classification: AgentClassificationSchema,
  reasoningSummary: z.string().min(1),
  evidenceReferences: z.array(z.string()),
  proposal: LlmRepairProposalSchema.optional(),
  verification: z.object({
    isolatedTestPassed: z.boolean().optional(),
    assertionsChanged: z.boolean().optional(),
    unrelatedFilesChanged: z.boolean().optional(),
  }).strict().optional(),
  humanApprovalRequired: z.boolean(),
}).strict();

export const AgentResponseSchema = z.discriminatedUnion('responseType', [AgentStepResponseSchema, AgentFinalResponseSchema]);

export type AgentStepResponse = z.infer<typeof AgentStepResponseSchema>;
export type AgentFinalResponse = z.infer<typeof AgentFinalResponseSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export interface AgentResponseParseResult {
  isValid: boolean;
  response?: AgentResponse;
  errors: string[];
}

function extractJsonCandidate(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function parseJsonInput(input: unknown): { candidate?: unknown; errors: string[] } {
  if (typeof input !== 'string') return { candidate: input, errors: [] };
  try {
    return { candidate: JSON.parse(extractJsonCandidate(input)), errors: [] };
  } catch (error) {
    return { errors: [`Response is not valid JSON: ${String(error)}`] };
  }
}

export function parseLlmRepairProposal(input: unknown): ProposalParseResult {
  const parsedInput = parseJsonInput(input);
  if (parsedInput.errors.length > 0) return { isValid: false, errors: parsedInput.errors.map((error) => error.replace(/^Response/, 'Proposal')) };
  const candidate = parsedInput.candidate;

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

export function parseAgentResponse(input: unknown): AgentResponseParseResult {
  const parsedInput = parseJsonInput(input);
  if (parsedInput.errors.length > 0) return { isValid: false, errors: parsedInput.errors };
  const parsed = AgentResponseSchema.safeParse(parsedInput.candidate);
  if (!parsed.success) return { isValid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  if (parsed.data.responseType === 'FINAL' && parsed.data.proposal) {
    const proposal = parseLlmRepairProposal(parsed.data.proposal);
    if (!proposal.isValid || !proposal.proposal) return { isValid: false, errors: proposal.errors };
    return { isValid: true, response: { ...parsed.data, proposal: proposal.proposal }, errors: [] };
  }
  return { isValid: true, response: parsed.data, errors: [] };
}

