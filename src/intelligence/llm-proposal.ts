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
  normalizationNotes?: string[] | undefined;
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
  normalizationNotes?: string[] | undefined;
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

function normalizeAgentCandidate(input: unknown): { candidate: unknown; notes: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { candidate: input, notes: [] };
  const source = input as Record<string, unknown>;
  if (source.responseType === 'FINAL') {
    // Accept a complete PIE final response unchanged. Compatibility handling
    // below is deliberately limited to documented sparse-final variants.
    if (AgentFinalResponseSchema.safeParse(input).success) return { candidate: input, notes: [] };

    const notes: string[] = [];
    const classification = source.classification && typeof source.classification === 'object' && !Array.isArray(source.classification)
      ? source.classification as Record<string, unknown>
      : {};
    const normalizedClassification = typeof classification.category === 'string'
      && typeof classification.confidence === 'number'
      && classification.confidence >= 0
      && classification.confidence <= 1
      ? { category: classification.category, confidence: classification.confidence }
      : { category: 'MODEL_RESPONSE', confidence: 0 };
    const evidenceReferences = Array.isArray(source.evidenceReferences)
      ? source.evidenceReferences.filter((value): value is string => typeof value === 'string')
      : [];
    const reasoningSummary = typeof source.reasoningSummary === 'string'
      ? source.reasoningSummary
      : 'The model returned an incomplete final response.';
    const humanApprovalRequired = typeof source.humanApprovalRequired === 'boolean' ? source.humanApprovalRequired : true;

    if (source.status === 'ABSTAIN') {
      notes.push('Normalized sparse FINAL ABSTAIN response with conservative classification and approval defaults.');
      return {
        candidate: {
          protocolVersion: '2',
          responseType: 'FINAL',
          status: 'ABSTAIN',
          classification: normalizedClassification,
          reasoningSummary,
          evidenceReferences,
          humanApprovalRequired,
        },
        notes,
      };
    }

    if (source.status === 'PROPOSAL' && source.proposal && typeof source.proposal === 'object' && !Array.isArray(source.proposal)) {
      const legacyProposal = source.proposal as Record<string, unknown>;
      const target = legacyProposal.target;
      const locator = legacyProposal.locator;
      if (target && typeof target === 'object' && !Array.isArray(target)
        && typeof (target as Record<string, unknown>).filePath === 'string'
        && typeof locator === 'string' && locator.length > 0) {
        notes.push('Mapped recognized legacy FINAL PROPOSAL shape to BLOCKED because it lacks a safe old-locator operation.');
        return {
          candidate: {
            protocolVersion: '2',
            responseType: 'FINAL',
            status: 'BLOCKED',
            classification: normalizedClassification,
            reasoningSummary: 'The model returned a source-location proposal without a complete PIE repair operation; no mutation was synthesized.',
            evidenceReferences,
            humanApprovalRequired: true,
          },
          notes,
        };
      }
    }

    const legacyFinalStatuses = new Set(['OK', 'PROPOSED', 'PROPOSAL_ONLY', 'REPAIR_PROPOSAL', 'COMPLETE']);
    if (typeof source.status === 'string' && legacyFinalStatuses.has(source.status)
      && source.proposal && typeof source.proposal === 'object' && !Array.isArray(source.proposal)) {
      const legacyProposal = source.proposal as Record<string, unknown>;
      const failureCategory = typeof legacyProposal.failureCategory === 'string'
        ? legacyProposal.failureCategory.trim().toUpperCase()
        : typeof legacyProposal.failureKind === 'string'
          ? legacyProposal.failureKind.trim().toUpperCase()
          : typeof legacyProposal.category === 'string'
            ? legacyProposal.category.trim().toUpperCase()
            : undefined;
      const confidence = typeof legacyProposal.confidence === 'number' && legacyProposal.confidence >= 0 && legacyProposal.confidence <= 1
        ? legacyProposal.confidence
        : 0;
      const summary = typeof legacyProposal.summary === 'string'
        ? legacyProposal.summary
        : typeof legacyProposal.rationale === 'string'
          ? legacyProposal.rationale
          : 'The model returned a legacy locator proposal.';
      const directTarget = typeof legacyProposal.oldLocator === 'string' ? legacyProposal.oldLocator
        : typeof legacyProposal.oldText === 'string' ? legacyProposal.oldText
          : typeof legacyProposal.originalLocator === 'string' ? legacyProposal.originalLocator : undefined;
      const directLocator = typeof legacyProposal.newLocator === 'string' ? legacyProposal.newLocator
        : typeof legacyProposal.newText === 'string' ? legacyProposal.newText
          : typeof legacyProposal.proposedLocator === 'string' ? legacyProposal.proposedLocator : undefined;
      const edits = Array.isArray(legacyProposal.edits) ? legacyProposal.edits : Array.isArray(legacyProposal.changes) ? legacyProposal.changes : [];
      const firstEdit = edits[0] && typeof edits[0] === 'object' && !Array.isArray(edits[0]) ? edits[0] as Record<string, unknown> : {};
      const target = directTarget
        ?? (typeof firstEdit.oldLocator === 'string' ? firstEdit.oldLocator : typeof firstEdit.oldText === 'string' ? firstEdit.oldText : undefined)
        ?? (typeof legacyProposal.target === 'string' ? legacyProposal.target : undefined);
      const locator = directLocator
        ?? (typeof firstEdit.newLocator === 'string' ? firstEdit.newLocator : typeof firstEdit.newText === 'string' ? firstEdit.newText : undefined)
        ?? (typeof legacyProposal.locator === 'string' ? legacyProposal.locator : undefined);
      const hasLegacyLocatorShape = typeof target === 'string'
        || typeof locator === 'string'
        || typeof legacyProposal.target === 'string'
        || typeof legacyProposal.locator === 'string'
        || edits.length > 0;
      const inferredLocatorDrift = failureCategory === undefined
        && source.status === 'PROPOSED'
        && typeof legacyProposal.target === 'string'
        && typeof legacyProposal.locator === 'string';

      if ((failureCategory === 'LOCATOR_DRIFT' || inferredLocatorDrift) && target && locator) {
        notes.push('Normalized recognized legacy locator proposal into the PIE replacement-operation schema.');
        return {
          candidate: {
            protocolVersion: '2',
            responseType: 'FINAL',
            status: 'PROPOSAL_READY',
            classification: { category: 'LOCATOR_DRIFT', confidence },
            reasoningSummary: summary,
            evidenceReferences,
            proposal: {
              proposalVersion: '1',
              decision: 'PROPOSE',
              failureKind: 'LOCATOR_DRIFT',
              confidence,
              reasoningSummary: summary,
              operations: [{ kind: 'replace_locator', target, locator }],
              requiredVerification: ['isolated target test', 'assertions unchanged'],
              evidenceReferences,
            },
            humanApprovalRequired: true,
          },
          notes,
        };
      }

      if (hasLegacyLocatorShape) {
        notes.push('Mapped an incomplete or non-locator legacy final proposal to BLOCKED; no mutation operation was synthesized.');
        return {
          candidate: {
            protocolVersion: '2',
            responseType: 'FINAL',
            status: 'BLOCKED',
            classification: normalizedClassification,
            reasoningSummary: 'The legacy proposal did not contain a safe LOCATOR_DRIFT replacement operation; no mutation was synthesized.',
            evidenceReferences,
            humanApprovalRequired: true,
          },
          notes,
        };
      }
    }

    return { candidate: input, notes };
  }
  if (source.responseType !== 'STEP' || source.status !== 'CONTINUE' || !source.action || typeof source.action !== 'object') {
    return { candidate: input, notes: [] };
  }

  const rawAction = source.action as Record<string, unknown>;
  const kind = rawAction.kind;
  const allowedActionFields = ['kind', 'selector', 'target', 'locator', 'sourceFile', 'className', 'memberName', 'reason'];
  const action: Record<string, unknown> = {};
  for (const field of allowedActionFields) {
    if (typeof rawAction[field] === 'string' && rawAction[field].length > 0) action[field] = rawAction[field];
  }
  const notes: string[] = [];
  const legacyProposal = rawAction.proposal;
  if (legacyProposal && typeof legacyProposal === 'object') {
    const legacy = legacyProposal as Record<string, unknown>;
    if (typeof legacy.oldLocator === 'string' && action.target === undefined) action.target = legacy.oldLocator;
    if (typeof legacy.oldText === 'string' && action.target === undefined) action.target = legacy.oldText;
    if (typeof legacy.newLocator === 'string' && action.locator === undefined) action.locator = legacy.newLocator;
    if (typeof legacy.newText === 'string' && action.locator === undefined) action.locator = legacy.newText;
    const edits = Array.isArray(legacy.edits) ? legacy.edits : Array.isArray(legacy.changes) ? legacy.changes : [];
    const firstEdit = edits[0] && typeof edits[0] === 'object' && !Array.isArray(edits[0]) ? edits[0] as Record<string, unknown> : {};
    if (typeof firstEdit.oldLocator === 'string' && action.target === undefined) action.target = firstEdit.oldLocator;
    if (typeof firstEdit.oldText === 'string' && action.target === undefined) action.target = firstEdit.oldText;
    if (typeof firstEdit.newLocator === 'string' && action.locator === undefined) action.locator = firstEdit.newLocator;
    if (typeof firstEdit.newText === 'string' && action.locator === undefined) action.locator = firstEdit.newText;
    notes.push('Dropped unsupported nested proposal metadata; retained only allowlisted locator fields.');
  }

  const decisionByAction: Record<string, string> = {
    inspect_evidence: 'INSPECT_EVIDENCE',
    discover_source_mapping: 'DISCOVER_SOURCE_MAPPING',
    rank_locator_candidates: 'RANK_LOCATOR_CANDIDATES',
    build_repair_proposal: 'BUILD_REPAIR_PROPOSAL',
    verify_repair: 'VERIFY_REPAIR',
    abstain: 'ABSTAIN',
  };
  const normalized: Record<string, unknown> = {
    protocolVersion: source.protocolVersion === '2' ? '2' : '2',
    responseType: 'STEP',
    status: 'CONTINUE',
    decision: typeof source.decision === 'string' ? source.decision : decisionByAction[String(kind)] ?? kind,
    confidence: typeof source.confidence === 'number' ? source.confidence : 0,
    reasoningSummary: typeof source.reasoningSummary === 'string' ? source.reasoningSummary : 'Model requested an allowlisted PIE observation.',
    evidenceReferences: Array.isArray(source.evidenceReferences) ? source.evidenceReferences.filter((value): value is string => typeof value === 'string') : [],
    action,
    requiredObservation: typeof source.requiredObservation === 'string' ? source.requiredObservation : 'Return the PIE action observation.',
  };
  if (source.decision === undefined) notes.push('Derived decision from the allowlisted action kind.');
  if (source.confidence === undefined) notes.push('Applied conservative confidence default 0.');
  if (source.reasoningSummary === undefined) notes.push('Applied a neutral reasoning summary because none was returned.');
  if (source.evidenceReferences === undefined) notes.push('Applied an empty evidence-reference list because none was returned.');
  if (source.requiredObservation === undefined) notes.push('Applied a default observation requirement because none was returned.');
  return { candidate: normalized, notes };
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
  const normalized = normalizeAgentCandidate(parsedInput.candidate);
  const parsed = AgentResponseSchema.safeParse(normalized.candidate);
  if (!parsed.success) return { isValid: false, errors: parsed.error.issues.map((issue) => issue.message), normalizationNotes: normalized.notes };
  if (parsed.data.responseType === 'FINAL' && parsed.data.proposal) {
    const proposal = parseLlmRepairProposal(parsed.data.proposal);
    if (!proposal.isValid || !proposal.proposal) return { isValid: false, errors: proposal.errors, normalizationNotes: normalized.notes };
    return { isValid: true, response: { ...parsed.data, proposal: proposal.proposal }, errors: [], normalizationNotes: normalized.notes };
  }
  return { isValid: true, response: parsed.data, errors: [], normalizationNotes: normalized.notes };
}

