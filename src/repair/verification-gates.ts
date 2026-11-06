import { z } from 'zod';
import { BusinessOracleStatus } from '../core/types/repair-evidence.js';

export const VerificationGateInputSchema = z.object({
  executionPassed: z.boolean(),
  targetIdentityPreserved: z.boolean(),
  assertionsIntact: z.boolean(),
  fixturesIntact: z.boolean(),
  diffAllowlistPassed: z.boolean(),
  regressionPassed: z.boolean(),
  operationValidated: z.boolean(),
  businessOracleStatus: z.enum(['verified', 'contradicted', 'unavailable']),
  requireBusinessOracle: z.boolean().default(false),
});

export type VerificationGateInput = z.input<typeof VerificationGateInputSchema>;

export interface VerificationGateResult {
  isPromotable: boolean;
  failedGates: string[];
  businessOracleStatus: BusinessOracleStatus;
}

export function evaluateVerificationGates(input: VerificationGateInput): VerificationGateResult {
  const normalized = VerificationGateInputSchema.parse(input);
  const failedGates: string[] = [];

  if (!normalized.executionPassed) failedGates.push('executionPassed');
  if (!normalized.targetIdentityPreserved) failedGates.push('targetIdentityPreserved');
  if (!normalized.assertionsIntact) failedGates.push('assertionsIntact');
  if (!normalized.fixturesIntact) failedGates.push('fixturesIntact');
  if (!normalized.diffAllowlistPassed) failedGates.push('diffAllowlistPassed');
  if (!normalized.regressionPassed) failedGates.push('regressionPassed');
  if (!normalized.operationValidated) failedGates.push('operationValidated');
  if (normalized.businessOracleStatus === 'contradicted') failedGates.push('businessOracleContradicted');
  if (normalized.requireBusinessOracle && normalized.businessOracleStatus !== 'verified') {
    failedGates.push('businessOracleRequired');
  }

  return {
    isPromotable: failedGates.length === 0,
    failedGates,
    businessOracleStatus: normalized.businessOracleStatus,
  };
}

