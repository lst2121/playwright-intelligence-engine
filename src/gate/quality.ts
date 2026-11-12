import { NamingLinter, NamingLintReport } from '../authoring/naming/naming-linter.js';
import type { NamePlan } from '../authoring/naming/name-plan.js';

export interface CodeQualityGateInput {
  symbols?: NamePlan | undefined;
  files?: Array<{ relativePath: string; content: string }> | undefined;
  diff?: string | undefined;
  originalSource?: string | undefined;
  patchedSource?: string | undefined;
  locatorPolicy?: string | undefined;
}

export type QualityGateInput = CodeQualityGateInput;

export interface QualityGateResult {
  passed: boolean;
  namingReport?: NamingLintReport | undefined;
  duplicateSelectors: string[];
  locatorPolicyViolations: string[];
  assertionStrengthPassed: boolean;
  changedLines: number;
  violations: string[];
}

export class QualityGate {
  public static evaluate(input: QualityGateInput): QualityGateResult {
    const violations: string[] = [];

    // 1. Naming Conformance
    let namingReport: NamingLintReport | undefined;
    if (input.symbols && input.symbols.symbols.length > 0) {
      namingReport = NamingLinter.lint(input.symbols);
      if (!namingReport.passed) {
        for (const v of namingReport.violations) {
          violations.push(`Naming quality violation [${v.kind}]: ${v.message}`);
        }
      }
    }

    // 2. Duplicate Selectors Check
    const duplicateSelectors: string[] = [];
    if (input.files) {
      for (const file of input.files) {
        if (file.relativePath.endsWith('Page.ts')) {
          const locatorMatches = [...file.content.matchAll(/this\.page\.(?:getByRole|getByText|getByTestId|locator)\s*\(([^)]+)\)/g)];
          const seen = new Set<string>();
          for (const match of locatorMatches) {
            const locStr = match[1]!.trim();
            if (seen.has(locStr)) {
              duplicateSelectors.push(locStr);
              violations.push(`Duplicate selector in '${file.relativePath}': ${locStr}`);
            }
            seen.add(locStr);
          }
        }
      }
    }

    // 3. Locator Policy Conformance (e.g. Reject raw CSS when ARIA is required)
    const locatorPolicyViolations: string[] = [];
    if (input.files && input.locatorPolicy === 'prefer-role-over-css') {
      for (const file of input.files) {
        const rawCssMatches = [...file.content.matchAll(/this\.page\.locator\s*\(\s*['"]([#.]|div|button|input)[^'"]*['"]\s*\)/g)];
        for (const match of rawCssMatches) {
          locatorPolicyViolations.push(match[0]);
          violations.push(`Locator policy violation in '${file.relativePath}': raw CSS used instead of role-based locator: ${match[0]}`);
        }
      }
    }

    // 4. Assertion Strength Non-Downgrade Check
    let assertionStrengthPassed = true;
    if (input.originalSource && input.patchedSource) {
      const origHasExactText = /\b(toHaveText|toHaveValue|toContainText)\b/.test(input.originalSource);
      const patchHasExactText = /\b(toHaveText|toHaveValue|toContainText)\b/.test(input.patchedSource);
      const patchDowngradedToVisible = /\btoBeVisible\b/.test(input.patchedSource) && !/\btoBeVisible\b/.test(input.originalSource);

      if (origHasExactText && !patchHasExactText && patchDowngradedToVisible) {
        assertionStrengthPassed = false;
        violations.push('Assertion strength regression: exact text assertion was downgraded to toBeVisible');
      }
    }

    // 5. Diff Minimality (Count changed lines)
    let changedLines = 0;
    if (input.diff) {
      const diffLines = input.diff.split(/\r?\n/);
      changedLines = diffLines.filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')).length;
    }

    return {
      passed: violations.length === 0,
      namingReport,
      duplicateSelectors,
      locatorPolicyViolations,
      assertionStrengthPassed,
      changedLines,
      violations,
    };
  }
}
