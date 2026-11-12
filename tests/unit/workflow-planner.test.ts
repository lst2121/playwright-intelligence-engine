import { describe, expect, it } from 'vitest';
import {
  buildWorkflowPlan,
  exportWorkflowToGherkin,
  GitDiffCollector,
  importGherkinToWorkflowPlan,
  isStaleWorkflowPlan,
} from '../../src/index.js';

describe('Phase B — Workflow Planner & Gherkin Round-Trip', () => {
  it('ingests Markdown requirements into grounded scenarios with traceability', () => {
    const md = `# Task Management

## Acceptance Criteria
- Users can create a task and see it in the list
- Empty task titles must be rejected
- Tasks persist after page reload
`;
    const plan = buildWorkflowPlan({ markdown: md, baseUrl: 'http://localhost:5173' });

    expect(plan.featureName).toBe('Task Management');
    expect(plan.requirements).toHaveLength(3);
    expect(plan.scenarios.some((s) => s.category === 'happy-path')).toBe(true);
    expect(plan.scenarios.some((s) => s.category === 'validation')).toBe(true);
    expect(plan.scenarios.some((s) => s.category === 'persistence')).toBe(true);
    expect(plan.scenarios.every((s) => s.requirementRefs.length > 0)).toBe(true);
    // Should NOT fabricate auth or boundary scenarios when not evidenced
    expect(plan.scenarios.some((s) => s.category === 'authentication')).toBe(false);
    expect(plan.scenarios.some((s) => s.category === 'boundary')).toBe(false);
  });

  it('ingests JSON and Jira-shaped requirements and detects covered existing scenarios', () => {
    const json = JSON.stringify([
      {
        id: 'SHOP-101',
        title: 'Add item to cart',
        description: 'Authenticated buyer adds product to cart and sees count update',
        acceptanceCriteria: ['Cart counter increments after clicking Add to Cart'],
      },
    ]);
    const plan = buildWorkflowPlan({
      featureName: 'Shopping Cart',
      jsonRequirements: json,
      existingTests: [
        {
          id: 'tests/cart.spec.ts#add',
          title: 'Add item to cart',
          sourceText: "test('Add item to cart', async () => { await expect(cartCounter).toHaveText('1'); });",
        },
      ],
    });

    expect(plan.requirements[0]!.id).toBe('SHOP-101');
    const happy = plan.scenarios.find((s) => s.category === 'happy-path');
    expect(happy?.requirementRefs).toContain('SHOP-101');
    expect(happy?.applicability).toBe('covered');
    expect(happy?.tags).toContain('@covered');
  });

  it('marks vague prompts without acceptance criteria as needs_clarification rather than inventing outcomes', () => {
    const plan = buildWorkflowPlan({ prompt: 'Improve it' });
    expect(plan.unresolvedQuestions.length).toBeGreaterThan(0);
    expect(plan.scenarios[0]!.applicability).toBe('needs_clarification');
    expect(plan.scenarios[0]!.expectedOutcomes).toEqual([]);
  });

  it('enriches workflow planning with GitDiffCollector hints without conflating provenance', () => {
    const rawDiff = `
+export const TaskSchema = z.object({ title: z.string().min(3).max(100) });
+const res = await fetch('/api/tasks', { method: 'POST' });
+export function TaskForm() {}
`;
    const hints = GitDiffCollector.extractDiffHints(rawDiff, ['src/app/tasks/page.tsx', 'tests/tasks.spec.ts']);
    expect(hints.changedRoutes).toContain('/tasks');
    expect(hints.apiEndpoints).toContain('/api/tasks');
    expect(hints.validationHints).toContain('min(3)');
    expect(hints.existingTestsChanged).toEqual(['tests/tasks.spec.ts']);

    const plan = buildWorkflowPlan({
      featureName: 'Tasks',
      prompt: 'Create new task via form',
      gitDiff: {
        changedFiles: ['src/app/tasks/page.tsx'],
        ...hints,
      },
    });
    expect(plan.diffSummary?.changedRoutes).toContain('/tasks');
    expect(plan.scenarios.some((s) => s.category === 'boundary' && s.provenance === 'diff-derived')).toBe(true);
    expect(plan.scenarios.some((s) => s.category === 'ui-api-consistency' && s.provenance === 'diff-derived')).toBe(true);
  });

  it('exports human-readable Gherkin and performs faithful round-trip import with edit & stale detection', () => {
    const plan = buildWorkflowPlan({
      featureName: 'Checkout Flow',
      markdown: '# Checkout Flow\n- Buyer completes order with valid shipping\n',
      baseUrl: 'http://localhost:3000',
    });
    const featureText = exportWorkflowToGherkin(plan);
    expect(featureText).toContain('Feature: Checkout Flow');
    expect(featureText).toContain(`# pie-plan-hash: ${plan.planHash}`);

    // Unedited import should report edited=false
    const unedited = importGherkinToWorkflowPlan(featureText, plan);
    expect(unedited.success).toBe(true);
    expect(unedited.edited).toBe(false);
    expect(isStaleWorkflowPlan(featureText, plan)).toBe(false);

    // Edit existing scenario & append new hand-written scenario
    const editedText = `${featureText.replace('Buyer completes order with valid shipping (happy-path)', 'Buyer completes checkout and gets receipt')}
  @negative @custom
  Scenario: Decline expired card
    When the buyer submits an expired card
    Then an expiration error banner appears
`;
    expect(isStaleWorkflowPlan(editedText, plan)).toBe(true);

    const imported = importGherkinToWorkflowPlan(editedText, plan);
    expect(imported.success).toBe(true);
    expect(imported.edited).toBe(true);
    expect(imported.modifiedScenarioIds).toEqual([plan.scenarios[0]!.id]);
    expect(imported.addedScenarioIds).toHaveLength(1);
    expect(imported.plan!.scenarios).toHaveLength(plan.scenarios.length + 1);
    expect(imported.plan!.planHash).not.toBe(plan.planHash);
  });

  it('rejects unsupported Gherkin syntax and duplicate scenario IDs cleanly', () => {
    const plan = buildWorkflowPlan({ featureName: 'Login', prompt: 'User signs in with credentials' });

    const outlineText = `Feature: Login
  Scenario Outline: Bad login
    When user enters <email>
    Then error shows
    Examples:
      | email |
      | a@b   |
`;
    const outlineRes = importGherkinToWorkflowPlan(outlineText, plan);
    expect(outlineRes.success).toBe(false);
    expect(outlineRes.errors[0]).toContain('UNSUPPORTED_GHERKIN_SYNTAX');

    const dupIdText = `Feature: Login
  @id:sc-dup
  Scenario: One
    When user signs in
    Then dashboard opens

  @id:sc-dup
  Scenario: Two
    When user logs out
    Then login opens
`;
    const dupRes = importGherkinToWorkflowPlan(dupIdText, plan);
    expect(dupRes.success).toBe(false);
    expect(dupRes.errors.some((e) => e.includes('DUPLICATE_SCENARIO_ID'))).toBe(true);
  });
});
