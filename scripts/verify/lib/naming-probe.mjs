#!/usr/bin/env node
/**
 * Naming probe — feeds the linter the identifiers the generator actually
 * produces, and requires rejection.
 *
 * Fails while the linter still accepts generic role-derived identifiers.
 */
import { NamingLinter } from '../../../dist/index.js';

const genericPlan = {
  planVersion: '1',
  pageClassName: 'OrderReviewPage',
  pageVariable: 'orderReviewPage',
  symbols: [
    {
      ref: 'step-1',
      property: 'actionButton',
      method: 'performActionButton',
      verb: 'perform',
      confidence: 0.75,
      source: 'heuristic',
      assumptions: [],
    },
  ],
  assumptions: [],
};

const report = NamingLinter.lint(genericPlan);

if (report.passed) {
  console.log("FAIL linter accepted generic identifiers 'actionButton' / 'performActionButton' (0 violations)");
  process.exit(1);
}

const kinds = [...new Set(report.violations.map((v) => v.kind))].join(',');
console.log(`OK linter rejected generic identifiers (${kinds})`);
