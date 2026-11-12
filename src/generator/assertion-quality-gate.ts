export interface AssertionQualityReport {
  passed: boolean;
  assertionCount: number;
  hasStateAssertion: boolean;
  isVacuousEcho: boolean;
  constantAssertionCount: number;
  arbitrarySleepCount: number;
  emptyOrSkippedCount: number;
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
    const expectMatches = [...specContent.matchAll(/\bexpect(?:\.soft|\.poll)?\s*\(/g)];
    const assertionCount = expectMatches.length;

    if (assertionCount === 0) {
      violations.push('ZERO_ASSERTIONS: Generated spec contains zero expect() assertions.');
    }

    // 2. Check for constant assertions (e.g. expect(true).toBe(true), expect(1).toBe(1))
    const constantMatches = [
      ...specContent.matchAll(
        /\bexpect\s*\(\s*(?:true|false|\d+|['"][^'"]*['"])\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*(?:true|false|\d+|['"][^'"]*['"])\s*\)/g,
      ),
    ];
    const constantAssertionCount = constantMatches.length;
    if (constantAssertionCount > 0) {
      violations.push(`CONSTANT_ASSERTION: Spec contains ${constantAssertionCount} constant assertion(s) that do not inspect application state.`);
    }

    // 3. Check for arbitrary waitForTimeout sleeps
    const sleepMatches = [...specContent.matchAll(/\bwaitForTimeout\s*\(\s*\d+\s*\)/g)];
    const arbitrarySleepCount = sleepMatches.length;
    if (arbitrarySleepCount > 0) {
      violations.push(`ARBITRARY_SLEEP: Spec uses waitForTimeout() (${arbitrarySleepCount}x) instead of web-first assertions or state waits.`);
    }

    // 4. Check for empty or skipped tests
    const skippedMatches = [...specContent.matchAll(/\btest\s*\.\s*(?:skip|fixme)\s*\(/g)];
    const emptyBodyMatches = [...specContent.matchAll(/\btest\s*\([^,]+,\s*async\s*\([^)]*\)\s*=>\s*\{\s*\}\s*\)/g)];
    const emptyOrSkippedCount = skippedMatches.length + emptyBodyMatches.length;
    if (emptyOrSkippedCount > 0) {
      violations.push(`EMPTY_OR_SKIPPED_TEST: Spec contains ${emptyOrSkippedCount} skipped or empty test case(s).`);
    }

    // 5. Check for web-first / response assertions
    const stateAssertionRegex = /\b(toBeVisible|toBeHidden|toHaveText|toContainText|toHaveCount|toBeChecked|toHaveValue|toBeEmpty|toBeEnabled|toBeDisabled|toHaveAttribute|toHaveClass|toHaveURL|toHaveTitle|toBeOK)\b/;
    const hasStateAssertion = stateAssertionRegex.test(specContent);

    if (assertionCount > 0 && !hasStateAssertion) {
      violations.push('WEAK_ASSERTION: Generated spec contains no auto-retrying web-first state assertions.');
    }

    // 6. Check for vacuous echo assertion
    // An echo assertion is when the ONLY assertion in the spec is expecting a heading with the exact featureName string.
    let isVacuousEcho = false;
    if (assertionCount === 1) {
      const escapedFeature = featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const headingEchoRegex = new RegExp(
        `expect\\s*\\(\\s*page\\.getByRole\\s*\\(\\s*['"]heading['"]\\s*,\\s*\\{\\s*name:\\s*['"]${escapedFeature}['"]\\s*\\}\\s*\\)\\s*\\)\\.toBeVisible\\(\\)`,
      );
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
      constantAssertionCount,
      arbitrarySleepCount,
      emptyOrSkippedCount,
      violations,
    };
  }
}

