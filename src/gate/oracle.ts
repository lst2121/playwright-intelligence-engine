import { BusinessOracleStatus } from '../core/types/repair-evidence.js';
import { evaluateBuiltInBusinessOracles, BusinessIntent } from '../intelligence/business-intent.js';

export interface OracleGateInput {
  intent?: BusinessIntent | undefined;
  oracles?: Array<{ id: string; name: string; verified: boolean; required?: boolean }> | undefined;
  originalSourceText?: string | undefined;
  currentSourceText?: string | undefined;
  originalAssertions?: string[] | undefined;
  currentAssertions?: string[] | undefined;
  observedStates?: Record<string, unknown> | undefined;
  executionPassed?: boolean | undefined;
}

export interface OracleGateResult {
  passed: boolean;
  status: BusinessOracleStatus;
  reasons: string[];
}

export class OracleGate {
  public static evaluate(input: OracleGateInput): OracleGateResult {
    // 1. Explicit business oracles
    if (input.oracles && input.oracles.length > 0) {
      const reasons: string[] = [];
      let allPassed = true;
      let hasUnavailable = false;

      for (const o of input.oracles) {
        if (!o.verified) {
          if (o.required !== false) {
            allPassed = false;
            hasUnavailable = true;
            reasons.push(`Required business oracle '${o.name}' is unverified.`);
          }
        }
      }

      return {
        passed: allPassed,
        status: allPassed ? 'verified' : (hasUnavailable ? 'unavailable' : 'contradicted'),
        reasons,
      };
    }

    if (!input.intent) {
      // Missing business intent evidence is NEVER marked verified
      return {
        passed: true,
        status: 'unavailable',
        reasons: ['No explicit business intent provided for oracle evaluation.'],
      };
    }

    const evaluation = evaluateBuiltInBusinessOracles({
      intent: input.intent,
      originalSourceText: input.originalSourceText ?? (input.originalAssertions ? input.originalAssertions.join('\n') : undefined),
      currentSourceText: input.currentSourceText ?? (input.currentAssertions ? input.currentAssertions.join('\n') : undefined),
      executionPassed: input.executionPassed ?? true,
    });

    const passed = evaluation.status !== 'contradicted';
    return {
      passed,
      status: evaluation.status,
      reasons: evaluation.results.map((r) => `${r.name}: ${r.status} (${r.reason})`),
    };
  }
}
