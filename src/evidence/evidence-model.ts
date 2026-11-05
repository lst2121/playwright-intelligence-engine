import { z } from 'zod';

export const EvidenceSourceSchema = z.enum([
  'trace',
  'live-browser',
  'console',
  'network',
  'static-ast',
  'git-diff',
  'environment',
  'error',
]);

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const ReliabilityLevelSchema = z.enum([
  'HIGH',
  'MEDIUM',
  'LOW',
  'UNVERIFIED',
]);

export type ReliabilityLevel = z.infer<typeof ReliabilityLevelSchema>;

export const ProvenanceMetadataSchema = z.object({
  collector: z.string(),
  collectedAt: z.number(),
  captureMethod: z.string(),
  sourceUri: z.string().optional(),
});

export type ProvenanceMetadata = z.infer<typeof ProvenanceMetadataSchema>;

export const RedactionStatusSchema = z.object({
  isRedacted: z.boolean(),
  redactedFields: z.array(z.string()).optional(),
  redactionRulesApplied: z.array(z.string()).optional(),
});

export type RedactionStatus = z.infer<typeof RedactionStatusSchema>;

export const UnifiedEvidenceRecordSchema = z.object({
  evidenceId: z.string(),
  executionId: z.string(),
  source: EvidenceSourceSchema,
  timestamp: z.number(),
  monotonicTimestamp: z.number().optional(),
  workerId: z.string().optional(),
  testId: z.string().optional(),
  frameId: z.string().optional(),
  actionId: z.string().optional(),
  requestId: z.string().optional(),
  evidenceType: z.string(), // e.g. 'dom-snapshot', 'console-error', 'http-response', 'ast-locator', 'git-commit'
  payload: z.record(z.string(), z.any()),
  reliability: ReliabilityLevelSchema,
  provenance: ProvenanceMetadataSchema,
  redactionStatus: RedactionStatusSchema,
  limitations: z.array(z.string()).optional(),
});

export type UnifiedEvidenceRecord = z.infer<typeof UnifiedEvidenceRecordSchema>;

export interface EvidenceScorecard {
  playwrightErrorAvailable: boolean;
  testSourceAstAvailable: boolean;
  domSnapshotAvailable: boolean;
  consoleEventsAvailable: boolean;
  networkEventsAvailable: boolean;
  traceArchiveAvailable: boolean;
  gitHistoryAvailable: boolean;
  environmentMetadataAvailable: boolean;
  totalRecordsCount: number;
  availableSources: EvidenceSource[];
  unavailableSources: EvidenceSource[];
}
