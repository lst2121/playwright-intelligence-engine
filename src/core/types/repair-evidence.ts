import { z } from 'zod';

export const SourceLocationSchema = z.object({
  filePath: z.string(),
  className: z.string(),
  memberName: z.string(),
  nodeKind: z.enum(['property', 'constructor-assignment', 'getter-return']),
  line: z.number(),
  column: z.number().optional(),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const BusinessOracleStatusSchema = z.enum([
  'verified',
  'contradicted',
  'unavailable',
]);

export type BusinessOracleStatus = z.infer<typeof BusinessOracleStatusSchema>;

export const RepairEvidenceSchema = z.object({
  originalActionId: z.string(),
  originalSelector: z.string(),
  candidateSelector: z.string(),
  candidateScore: z.number(),
  sourceLocation: SourceLocationSchema,
  targetIdentityEvidence: z.array(z.string()),
  assertionFingerprint: z.string(),    // SHA-256 of AST expect() blocks (must remain identical)
  businessOracleStatus: BusinessOracleStatusSchema,
  verificationWorktreeId: z.string(),
  repairedTestDurationMs: z.number(),
  timestamp: z.number(),
  repairedSuccessfully: z.boolean(),
});

export type RepairEvidence = z.infer<typeof RepairEvidenceSchema>;

