export interface AssertionQualityReport {
  passed: boolean;
  assertionCount: number;
  hasStateAssertion: boolean;
  isVacuousEcho: boolean;
  violations: string[];
}

export class AssertionQualityGate {
  /**
   * Evaluates the assertion quality of a generated Playwright spec file.
   * Enforces that generated tests are behavioral, non-vacuous, and contain real assertions.
   */
  public static evaluate(specContent: string, featureName: string): AssertionQualityReport {
    const violations: string[] = [];

    // 1. Count assertions
    const expectMatches = [...specContent.matchAll(/\bexpect\s*\(/g)];
    const assertionCount = expectMatches.length;

    if (assertionCount === 0) {
      violations.push('ZERO_ASSERTIONS: Generated spec contains zero expect() assertions.');
    }

    // 2. Check for state-change assertions
    const stateAssertionRegex = /\b(toBeVisible|toHaveText|toContainText|toHaveCount|toBeChecked|toHaveValue|toBeEnabled|toBeDisabled|toHaveAttribute|toHaveClass)\b/;
    const hasStateAssertion = stateAssertionRegex.test(specContent);

    if (assertionCount > 0 && !hasStateAssertion) {
      violations.push('WEAK_ASSERTION: Generated spec contains no auto-retrying web-first state assertions.');
    }

    // 3. Check for vacuous echo assertion
    // An echo assertion is when the ONLY assertion in the spec is expecting a heading with the exact featureName string.
    let isVacuousEcho = false;
    if (assertionCount === 1) {
      const escapedFeature = featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const headingEchoRegex = new RegExp(`expect\\s*\\(\\s*page\\.getByRole\\s*\\(\\s*['"]heading['"]\\s*,\\s*\\{\\s*name:\\s*['"]${escapedFeature}['"]\\s*\\}\\s*\\)\\s*\\)\\.toBeVisible\\(\\)`);
      if (headingEchoRegex.test(specContent)) {
        isVacuousEcho = true;
        violations.push(`VACUOUS_ECHO_ASSERTION: Spec only asserts visibility of input feature name '${featureName}' without verifying dynamic application behavior.`);
      }
    }

    return {
      passed: violations.length === 0,
      assertionCount,
      hasStateAssertion,
      isVacuousEcho,
      violations,
    };
  }
}
