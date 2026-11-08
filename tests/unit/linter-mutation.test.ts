import { describe, expect, it } from 'vitest';
import { NamingLinter, type NamePlan } from '../../src/index.js';

describe('Naming Linter Mutation Suite — Falsifiable Rejection of Bad Patterns', () => {
  const baseValidSymbol = {
    ref: 'step-1',
    role: 'button',
    accessibleName: 'Save Changes',
    property: 'saveChangesButton',
    method: 'submitSaveChanges',
    verb: 'submit',
    confidence: 0.95,
    source: 'heuristic' as const,
    assumptions: [],
  };

  const createPlan = (overrides?: Partial<NamePlan>): NamePlan => ({
    planVersion: '1',
    pageClassName: 'UserProfilePage',
    pageVariable: 'userProfilePage',
    symbols: [baseValidSymbol],
    assumptions: [],
    ...overrides,
  });

  const mutationCases: Array<{
    name: string;
    expectedViolation: string;
    buildPlan: () => NamePlan;
  }> = [
    {
      name: 'MUT-01: Rejects duplicated adjacent words in property (buttonButton)',
      expectedViolation: 'DUPLICATE_WORD_IN_IDENTIFIER',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              property: 'buttonButton',
            },
          ],
        }),
    },
    {
      name: 'MUT-02: Rejects duplicated adjacent words in method (performButtonbutton)',
      expectedViolation: 'DUPLICATE_WORD_IN_IDENTIFIER',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              method: 'performButtonbutton',
            },
          ],
        }),
    },
    {
      name: 'MUT-03: Rejects flattened compound class name (OrderreviewPage)',
      expectedViolation: 'CLASS_NAME_CASING',
      buildPlan: () =>
        createPlan({
          pageClassName: 'OrderreviewPage',
        }),
    },
    {
      name: 'MUT-04: Rejects non-PascalCase class name (user_login_page)',
      expectedViolation: 'CLASS_NAME_CASING',
      buildPlan: () =>
        createPlan({
          pageClassName: 'user_login_page',
        }),
    },
    {
      name: 'MUT-05: Rejects positional index-derived property name (emailInput1 for step 1)',
      expectedViolation: 'INDEX_DERIVED_IDENTIFIER',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              property: 'emailInput1',
            },
          ],
        }),
    },
    {
      name: 'MUT-06: Rejects positional index-derived method name (click1 for step 1)',
      expectedViolation: 'INDEX_DERIVED_IDENTIFIER',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              method: 'click1',
            },
          ],
        }),
    },
    {
      name: 'MUT-07: Rejects generic indexed property (actionButton1)',
      expectedViolation: 'INDEX_DERIVED_IDENTIFIER',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              property: 'actionButton1',
            },
          ],
        }),
    },
    {
      name: 'MUT-08: Rejects zero semantic overlap between symbol and accessible name',
      expectedViolation: 'ZERO_SEMANTIC_OVERLAP',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ref: 'step-1',
              role: 'button',
              accessibleName: 'Complete Order Details',
              property: 'unrelatedWidget',
              method: 'clickUnrelated',
              verb: 'click',
              confidence: 0.9,
              source: 'heuristic',
              assumptions: [],
            },
          ],
        }),
    },
    {
      name: 'MUT-09: Rejects duplicate property names across symbols',
      expectedViolation: 'DUPLICATE_PROPERTY',
      buildPlan: () =>
        createPlan({
          symbols: [
            { ...baseValidSymbol, ref: 'step-1', property: 'saveButton', method: 'submit' },
            { ...baseValidSymbol, ref: 'step-2', property: 'saveButton', method: 'submitConfirm' },
          ],
        }),
    },
    {
      name: 'MUT-10: Rejects duplicate method names across symbols',
      expectedViolation: 'DUPLICATE_METHOD',
      buildPlan: () =>
        createPlan({
          symbols: [
            { ...baseValidSymbol, ref: 'step-1', property: 'saveButton', method: 'submit' },
            { ...baseValidSymbol, ref: 'step-2', property: 'confirmButton', method: 'submit' },
          ],
        }),
    },
    {
      name: 'MUT-11: Rejects reserved word collisions in property (constructor)',
      expectedViolation: 'RESERVED_WORD_COLLISION',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              property: 'constructor',
            },
          ],
        }),
    },
    {
      name: 'MUT-12: Rejects unapproved verb in method (exploit)',
      expectedViolation: 'MISSING_VERB',
      buildPlan: () =>
        createPlan({
          symbols: [
            {
              ...baseValidSymbol,
              verb: 'exploit',
              method: 'exploitSystem',
            },
          ],
        }),
    },
  ];

  it.each(mutationCases)('$name', ({ expectedViolation, buildPlan }) => {
    const plan = buildPlan();
    const report = NamingLinter.lint(plan);

    expect(report.passed).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.kind === expectedViolation)).toBe(true);
  });
});

