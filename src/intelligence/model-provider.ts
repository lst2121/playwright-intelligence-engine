import { EvidenceBundle, parseLlmRepairProposal, ProposalParseResult } from './llm-proposal.js';

export interface ProposalProvider {
  propose(bundle: EvidenceBundle): Promise<ProposalParseResult>;
}

export interface OpenAiCompatibleProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  onUsage?: ((usage: ModelUsage) => void) | undefined;
}

export interface ModelUsage {
  provider: 'openai-compatible' | 'anthropic-compatible';
  model: string;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  estimatedCostUsd?: number | undefined;
  durationMs: number;
}

export interface AnthropicCompatibleProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  anthropicVersion?: string | undefined;
  maxTokens?: number | undefined;
  inputCostPerMillionTokens?: number | undefined;
  outputCostPerMillionTokens?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  onUsage?: ((usage: ModelUsage) => void) | undefined;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  output_text?: string;
}

/**
 * Calls any OpenAI-compatible JSON model endpoint. The provider sends only the
 * normalized, redaction-aware evidence bundle and accepts only the strict PIE
 * proposal schema in return.
 */
export class OpenAiCompatibleProposalProvider implements ProposalProvider {
  private readonly options: OpenAiCompatibleProviderOptions;

  public constructor(options: OpenAiCompatibleProviderOptions) {
    this.options = options;
  }

  public async propose(bundle: EvidenceBundle): Promise<ProposalParseResult> {
    if (!bundle.redactionComplete) {
      return { isValid: false, errors: ['Evidence bundle is not marked redaction-complete'] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const started = Date.now();
    try {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(this.options.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Return only a JSON object matching the PIE LlmRepairProposal schema. Never return source code outside an allowlisted operation.',
            },
            { role: 'user', content: JSON.stringify(bundle) },
          ],
        }),
      });

      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = (await response.json()) as ChatCompletionResponse;
      const usage = (payload as ChatCompletionResponse & { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
      this.options.onUsage?.({
        provider: 'openai-compatible',
        model: this.options.model,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        durationMs: Date.now() - started,
      });
      const content = this.extractContent(payload);
      if (!content) return { isValid: false, errors: ['Model endpoint returned no JSON proposal content'] };
      return parseLlmRepairProposal(content);
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'Model request timed out' : 'Model request failed';
      return { isValid: false, errors: [message] };
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractContent(payload: ChatCompletionResponse): string | undefined {
    if (typeof payload.output_text === 'string') return payload.output_text;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('');
    return undefined;
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Calls an Anthropic Messages-compatible endpoint without coupling PIE to an SDK. */
export class AnthropicCompatibleProposalProvider implements ProposalProvider {
  private readonly options: AnthropicCompatibleProviderOptions;

  public constructor(options: AnthropicCompatibleProviderOptions) {
    this.options = options;
  }

  public async propose(bundle: EvidenceBundle): Promise<ProposalParseResult> {
    if (!bundle.redactionComplete) return { isValid: false, errors: ['Evidence bundle is not marked redaction-complete'] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const started = Date.now();
    try {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(this.options.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { 'x-api-key': this.options.apiKey } : {}),
          'anthropic-version': this.options.anthropicVersion ?? '2023-06-01',
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: this.options.maxTokens ?? 2048,
          temperature: 0,
          system: 'Return only a JSON object matching the PIE LlmRepairProposal schema. Never return source code outside an allowlisted operation.',
          messages: [{ role: 'user', content: JSON.stringify(bundle) }],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = await response.json() as AnthropicResponse;
      const inputTokens = payload.usage?.input_tokens;
      const outputTokens = payload.usage?.output_tokens;
      const totalTokens = inputTokens === undefined && outputTokens === undefined ? undefined : (inputTokens ?? 0) + (outputTokens ?? 0);
      const estimatedCostUsd = inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) / 1_000_000 * (this.options.inputCostPerMillionTokens ?? 0) + (outputTokens ?? 0) / 1_000_000 * (this.options.outputCostPerMillionTokens ?? 0);
      this.options.onUsage?.({ provider: 'anthropic-compatible', model: this.options.model, inputTokens, outputTokens, totalTokens, estimatedCostUsd, durationMs: Date.now() - started });
      const content = payload.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      if (!content) return { isValid: false, errors: ['Model endpoint returned no JSON proposal content'] };
      return parseLlmRepairProposal(content);
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'Model request timed out' : 'Model request failed';
      return { isValid: false, errors: [message] };
    } finally {
      clearTimeout(timeout);
    }
  }
}

