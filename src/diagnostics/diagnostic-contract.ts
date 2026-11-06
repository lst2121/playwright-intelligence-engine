import { z } from 'zod';
import { DiagnosticContext, FailureCategory, FailureCategorySchema } from '../core/types/diagnostic-context.js';
import { ClassificationResult } from './failure-classifier.js';

export const DiagnosticRecommendationSchema = z.enum([
  'REPAIR_CANDIDATE',
  'REPRODUCE_WITH_MORE_EVIDENCE',
  'REPORT_APPLICATION_OR_ENVIRONMENT_FAILURE',
  'ABSTAIN_FROM_REPAIR',
]);

export type DiagnosticRecommendation = z.infer<typeof DiagnosticRecommendationSchema>;

export const DiagnosticDecisionSchema = z.object({
  category: FailureCategorySchema,
  confidence: z.number().min(0).max(1),
  shouldAbstain: z.boolean(),
  reason: z.string(),
  recommendation: DiagnosticRecommendationSchema,
  supportingEvidence: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  provenance: z.object({
    failedActionId: z.string(),
    traceFormatVersion: z.number(),
    playwrightVersion: z.string(),
  }),
});

export type DiagnosticDecision = z.infer<typeof DiagnosticDecisionSchema>;

function recommendationFor(classification: ClassificationResult): DiagnosticRecommendation {
  if (classification.shouldAbstain) {
    if (
      classification.category === 'BACKEND_500' ||
      classification.category === 'AUTH_EXPIRED' ||
      classification.category === 'AUTH_SESSION_EXPIRED' ||
      classification.category === 'ENVIRONMENT_FAILURE' ||
      classification.category === 'ASSERTION_FAILURE' ||
      classification.category === 'ASSERTION_FAILED'
    ) {
      return 'REPORT_APPLICATION_OR_ENVIRONMENT_FAILURE';
    }
    return 'ABSTAIN_FROM_REPAIR';
  }

  if (classification.category === 'INCOMPLETE_EVIDENCE') return 'REPRODUCE_WITH_MORE_EVIDENCE';
  if (classification.category === 'LOCATOR_DRIFT') return 'REPAIR_CANDIDATE';
  return 'ABSTAIN_FROM_REPAIR';
}

function missingEvidenceFor(context: DiagnosticContext): string[] {
  const missing: string[] = [];
  if (!context.evidenceCompleteness.domAvailable) missing.push('DOM or accessibility snapshot');
  if (!context.evidenceCompleteness.networkAvailable) missing.push('network timeline');
  if (!context.evidenceCompleteness.sourceAvailable) missing.push('test source and Page Object context');
  return missing;
}

export function createDiagnosticDecision(
  context: DiagnosticContext,
  classification: ClassificationResult,
): DiagnosticDecision {
  return DiagnosticDecisionSchema.parse({
    category: classification.category as FailureCategory,
    confidence: classification.confidence,
    shouldAbstain: classification.shouldAbstain,
    reason: classification.reason,
    recommendation: recommendationFor(classification),
    supportingEvidence: classification.supportingEvidence,
    missingEvidence: missingEvidenceFor(context),
    provenance: {
      failedActionId: context.failedAction.callId,
      traceFormatVersion: context.traceFormatVersion,
      playwrightVersion: context.playwrightVersion,
    },
  });
}

