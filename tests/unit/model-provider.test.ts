import { describe, expect, it } from 'vitest';
import { AnthropicCompatibleProposalProvider } from '../../src/intelligence/model-provider.js';

const bundle = {
  bundleId: 'b1',
  executionId: 'e1',
  testIdentity: 'login.spec.ts',
  redactionComplete: true,
  sourceContext: [],
  artifacts: [],
  limitations: [],
};

describe('provider-neutral model integration', () => {
  it('accepts Anthropic-compatible structured output and records usage', async () => {
    let usage;
    const provider = new AnthropicCompatibleProposalProvider({
      endpoint: 'http://localhost:9999/v1/messages',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 2048,
      inputCostPerMillionTokens: 3,
      outputCostPerMillionTokens: 15,
      onUsage: (value) => { usage = value; },
      fetchImpl: (async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.max_tokens).toBe(2048);
        expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-key');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ type: 'text', text: JSON.stringify({
              proposalVersion: '1', decision: 'ABSTAIN', failureKind: 'BACKEND_500', confidence: 0.99,
              reasoningSummary: 'Backend failure.', operations: [{ kind: 'abstain', reason: 'Application failure.' }],
              requiredVerification: ['business_oracle'], evidenceReferences: [],
            }) }],
            usage: { input_tokens: 1000, output_tokens: 200 },
          }),
        } as Response;
      }) as typeof fetch,
    });
    const result = await provider.propose(bundle);
    expect(result.isValid).toBe(true);
    expect(usage).toMatchObject({ provider: 'anthropic-compatible', totalTokens: 1200, estimatedCostUsd: 0.006 });
  });
});
