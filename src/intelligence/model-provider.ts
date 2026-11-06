import { AgentResponseParseResult, EvidenceBundle, parseAgentResponse, parseLlmRepairProposal, ProposalParseResult } from './llm-proposal.js';

export interface ProposalProvider {
  propose(bundle: EvidenceBundle): Promise<ProposalParseResult>;
}

export interface AgentStepRequest {
  bundle: EvidenceBundle;
  deterministicCategory: string;
  deterministicConfidence: number;
  observation: unknown;
  stepIndex: number;
  maxSteps: number;
}

export interface AgentStepProvider {
  proposeStep(input: AgentStepRequest): Promise<AgentResponseParseResult>;
}

export interface OpenAiCompatibleProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  maxOutputTokens?: number | undefined;
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
export class OpenAiCompatibleProposalProvider implements ProposalProvider, AgentStepProvider {
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
          max_tokens: this.options.maxOutputTokens ?? 2048,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: proposalSystemPrompt(),
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

  public async proposeStep(input: AgentStepRequest): Promise<AgentResponseParseResult> {
    if (!input.bundle.redactionComplete) return { isValid: false, errors: ['Evidence bundle is not marked redaction-complete'] };
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
          max_tokens: this.options.maxOutputTokens ?? 2048,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: agentSystemPrompt() },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = (await response.json()) as ChatCompletionResponse;
      this.recordUsage(payload, started);
      const content = this.extractContent(payload);
      if (!content) return { isValid: false, errors: ['Model endpoint returned no agent response content'] };
      return parseAgentResponse(content);
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'Model request timed out' : 'Model request failed';
      return { isValid: false, errors: [message] };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordUsage(payload: ChatCompletionResponse, started: number): void {
    const usage = (payload as ChatCompletionResponse & { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
    this.options.onUsage?.({
      provider: 'openai-compatible',
      model: this.options.model,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
      durationMs: Date.now() - started,
    });
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
export class AnthropicCompatibleProposalProvider implements ProposalProvider, AgentStepProvider {
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
          system: proposalSystemPrompt(),
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

  public async proposeStep(input: AgentStepRequest): Promise<AgentResponseParseResult> {
    if (!input.bundle.redactionComplete) return { isValid: false, errors: ['Evidence bundle is not marked redaction-complete'] };
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
          system: agentSystemPrompt(),
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = await response.json() as AnthropicResponse;
      this.recordAnthropicUsage(payload, started);
      const content = payload.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      if (!content) return { isValid: false, errors: ['Model endpoint returned no agent response content'] };
      return parseAgentResponse(content);
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'Model request timed out' : 'Model request failed';
      return { isValid: false, errors: [message] };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordAnthropicUsage(payload: AnthropicResponse, started: number): void {
    const inputTokens = payload.usage?.input_tokens;
    const outputTokens = payload.usage?.output_tokens;
    const totalTokens = inputTokens === undefined && outputTokens === undefined ? undefined : (inputTokens ?? 0) + (outputTokens ?? 0);
    const estimatedCostUsd = inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) / 1_000_000 * (this.options.inputCostPerMillionTokens ?? 0) + (outputTokens ?? 0) / 1_000_000 * (this.options.outputCostPerMillionTokens ?? 0);
    this.options.onUsage?.({ provider: 'anthropic-compatible', model: this.options.model, inputTokens, outputTokens, totalTokens, estimatedCostUsd, durationMs: Date.now() - started });
  }
}

function proposalSystemPrompt(): string {
  return 'Return exactly one JSON object matching the PIE LlmRepairProposal schema. Do not use Markdown, code fences, explanations, patch objects, filePath fields, or extra keys. Use proposalVersion "1". decision must be PROPOSE or ABSTAIN. Every operation must use only the PIE allowlisted operation schema. Never return source code outside an operation.';
}

function agentSystemPrompt(): string {
  return 'Return exactly one JSON object and nothing else. Do not use Markdown or code fences. Use protocolVersion "2". Return either responseType STEP with status CONTINUE and one allowlisted action, or responseType FINAL. Allowed action kinds are inspect_evidence, discover_source_mapping, rank_locator_candidates, build_repair_proposal, verify_repair, and abstain. Never invent tools, file paths, patch formats, or extra keys. A repair proposal must use the nested PIE LlmRepairProposal schema with proposalVersion "1". If evidence is insufficient, return a FINAL response with status ABSTAIN.';
}

