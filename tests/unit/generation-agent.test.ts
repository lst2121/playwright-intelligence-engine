import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OpenAiCompatibleGenerationProvider,
  parseGenerationPlan,
  runGenerationAgent,
  GenerationPlanProvider,
} from '../../src/intelligence/generation-agent.js';

const plan = {
  planVersion: '1' as const,
  status: 'GENERATE' as const,
  reasoningSummary: 'The acceptance criterion describes one checkout workflow.',
  scenarios: [{
    id: 'scenario-checkout',
    title: 'Checkout flow',
    requirementId: 'checkout',
    steps: [
      { action: 'fill' as const, name: 'Email', value: 'qa@example.com' },
      { action: 'click' as const, role: 'button', name: 'Place order' },
      { action: 'assert-visible' as const, role: 'heading', name: 'Confirmation' },
    ],
    reasoningSummary: 'The flow contains input, submission, and an explicit outcome assertion.',
    evidenceReferences: ['requirement:checkout'],
  }],
  requiredClarifications: [],
  evidenceReferences: ['requirement:checkout'],
};

describe('generation agent', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['PIE_LLM_API_KEY', 'DEEPSEEK_API_KEY', 'PIE_LLM_ENDPOINT', 'PIE_LLM_MODEL', 'PIE_LIVE_LLM_TESTS']) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('accepts only the strict structured generation protocol', () => {
    expect(parseGenerationPlan(JSON.stringify(plan))).toMatchObject({ isValid: true, plan });
    expect(parseGenerationPlan(JSON.stringify({ ...plan, unsupported: true })).isValid).toBe(false);
    expect(parseGenerationPlan(JSON.stringify({ ...plan, status: 'NEEDS_INPUT', scenarios: [] })).isValid).toBe(false);
  });

  it('turns a model scenario plan into deterministic architecture files without writing by default', async () => {
    const provider: GenerationPlanProvider = {
      async propose() {
        return { isValid: true, plan, errors: [] };
      },
    };
    const result = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout', description: 'A customer can place an order.' }],
      mode: 'greenfield',
      provider,
      write: false,
    });
    expect(result.status).toBe('PLANNED');
    expect(result.provider).toBe('llm');
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]?.architecture.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      'tests/checkout-flow.spec.ts',
      'tests/pages/CheckoutFlowPage.ts',
      'playwright.config.ts',
    ]));
    expect(result.scenarios[0]?.writeResult).toBeUndefined();
  });

  it('refuses verification unless generated files are explicitly written', async () => {
    const provider: GenerationPlanProvider = {
      async propose() {
        return { isValid: true, plan, errors: [] };
      },
    };
    const result = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
      write: false,
      verify: true,
    });
    expect(result.status).toBe('ABSTAINED');
    expect(result.errors[0]).toContain('requires --write');
  });

  it('uses an explicit deterministic fallback when no LLM provider is configured', async () => {
    const result = await runGenerationAgent({
      requirements: [{ id: 'login', title: 'Login flow' }],
      mode: 'greenfield',
    });
    expect(result.status).toBe('PLANNED');
    expect(result.provider).toBe('deterministic-fallback');
    expect(result.scenarios[0]?.architecture.files).toHaveLength(5);
  });

  it('rejects generated actions that do not identify a target', async () => {
    const provider: GenerationPlanProvider = {
      async propose() {
        return {
          isValid: true,
          plan: {
            ...plan,
            scenarios: [{
              ...plan.scenarios[0]!,
              steps: [{ action: 'click' as const }],
            }],
          },
          errors: [],
        };
      },
    };
    const result = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
    });
    expect(result.status).toBe('ABSTAINED');
    expect(result.errors[0]).toContain('requires role/name or an explicit selector');
  });

  it('stops and transitions to AGENT_NO_PROGRESS when author repeats identical invalid proposal', async () => {
    const provider: GenerationPlanProvider = {
      async propose() {
        return { isValid: true, plan, errors: [] };
      },
    };
    // Mock author that repeatedly returns an index-derived name plan (which violates QualityGate)
    let callCount = 0;
    const loopingAuthor = {
      kind: 'hybrid' as const,
      async propose() {
        callCount++;
        return {
          files: [{ relativePath: 'tests/pages/CheckoutPage.ts', content: 'export class CheckoutPage {}' }],
          symbols: {
            planVersion: '1' as const,
            pageClassName: 'CheckoutPage',
            pageVariable: 'checkoutPage',
            symbols: [
              {
                ref: 'step-1',
                role: 'button',
                property: 'actionButton1', // violation!
                method: 'clickActionButton1',
                verb: 'click',
                confidence: 0.9,
                source: 'heuristic' as const,
                assumptions: [],
              },
            ],
            assumptions: [],
          },
          rationale: 'repeating invalid proposal',
          authorKind: 'hybrid' as const,
          featureName: 'Checkout flow',
          slug: 'checkout-flow',
          mode: 'greenfield' as const,
        };
      },
    };

    const result = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
      authorImpl: loopingAuthor,
      maxSteps: 3,
    });

    expect(result.status).toBe('AGENT_NO_PROGRESS');
    expect(result.scenarios[0]?.loopState).toBe('AGENT_NO_PROGRESS');
    expect(callCount).toBe(2); // First iteration sees signature, second sees identical signature and breaks!
    expect(result.errors[0]).toContain('detected no progress');
  });

  it('stops before running when time budget is already exhausted', async () => {
    const provider: GenerationPlanProvider = {
      async propose() {
        return { isValid: true, plan, errors: [] };
      },
    };
    const result = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
      maxDurationMs: 0,
    });

    expect(result.scenarios[0]?.loopState).toBe('AGENT_TIME_BUDGET');
  });

  it('records authorKind correctly across template, hybrid, and llm', async () => {
    const provider: GenerationPlanProvider = {
      async propose() {
        return { isValid: true, plan, errors: [] };
      },
    };
    const templateResult = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
      author: 'template',
    });
    expect(templateResult.authorKind).toBe('template');

    const hybridResult = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
      author: 'hybrid',
    });
    expect(hybridResult.authorKind).toBe('hybrid');

    const llmResult = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout' }],
      mode: 'greenfield',
      provider,
      author: 'llm',
    });
    expect(llmResult.authorKind).toBe('llm');
  });

  it('does not trigger live network calls when PIE_LLM_API_KEY is set under Vitest without opt-in', async () => {
    process.env.PIE_LLM_API_KEY = 'sk-test-should-not-hit-network';
    const result = await runGenerationAgent({
      requirements: [{ id: 'login', title: 'Login flow' }],
      mode: 'greenfield',
    });
    expect(result.status).toBe('PLANNED');
    expect(result.provider).toBe('deterministic-fallback');
  });

  it('supports mocked fetchImpl in OpenAiCompatibleGenerationProvider deterministically', async () => {
    const provider = new OpenAiCompatibleGenerationProvider({
      endpoint: 'https://mock.local/v1/chat/completions',
      model: 'mock-model',
      apiKey: 'mock-key',
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(plan) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const result = await runGenerationAgent({
      requirements: [{ id: 'checkout', title: 'Checkout', description: 'A customer can place an order.' }],
      mode: 'greenfield',
      provider,
    });
    expect(result.status).toBe('PLANNED');
    expect(result.provider).toBe('llm');
  });
});
