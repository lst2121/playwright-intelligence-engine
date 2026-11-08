import { SafetyGate, SafetyGateInput, SafetyGateResult } from './safety.js';
import { QualityGate, CodeQualityGateInput, QualityGateResult } from './quality.js';
import { OracleGate, OracleGateInput, OracleGateResult } from './oracle.js';

export * from './safety.js';
export { QualityGate, type QualityGateResult, type CodeQualityGateInput };
export * from './oracle.js';

export interface GateInput {
  safety: SafetyGateInput;
  quality?: CodeQualityGateInput | undefined;
  oracle?: OracleGateInput | undefined;
}

export interface GateEvaluationResult {
  passed: boolean;
  verdict: 'APPROVED' | 'REJECTED';
  safety: SafetyGateResult;
  quality: QualityGateResult;
  oracle: OracleGateResult;
  violations: string[];
}

export function runGate(input: GateInput): GateEvaluationResult {
  const safety = SafetyGate.evaluate(input.safety);
  const quality = QualityGate.evaluate(input.quality ?? {});
  const oracle = OracleGate.evaluate(input.oracle ?? {});

  const violations = [...safety.violations, ...quality.violations];
  if (!oracle.passed) {
    violations.push(`Oracle gate contradicted: ${oracle.reasons.join(', ')}`);
  }

  const passed = safety.passed && quality.passed && oracle.passed;
  return {
    passed,
    verdict: passed ? 'APPROVED' : 'REJECTED',
    safety,
    quality,
    oracle,
    violations,
  };
}
