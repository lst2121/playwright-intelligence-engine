import { AgentResponseParseResult, EvidenceBundle, parseAgentResponse, parseLlmRepairProposal, ProposalParseResult } from './llm-proposal.js';
import { AnthropicResponsePayload, createModelResponseDiagnostics, ModelCapabilities, ModelResponseDiagnostics, ModelResponseEnvelope, normalizeAnthropicResponse, normalizeOpenAiResponse, OpenAiCompatibleResponsePayload } from './model-contract.js';

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
  capabilities?: Partial<ModelCapabilities> | undefined;
  fetchImpl?: typeof fetch | undefined;
  onUsage?: ((usage: ModelUsage) => void) | undefined;
  onResponse?: ((diagnostics: ModelResponseDiagnostics) => void) | undefined;
  captureResponsePreview?: boolean | undefined;
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
  capabilities?: Partial<ModelCapabilities> | undefined;
  onUsage?: ((usage: ModelUsage) => void) | undefined;
  onResponse?: ((diagnostics: ModelResponseDiagnostics) => void) | undefined;
  captureResponsePreview?: boolean | undefined;
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

  public getCapabilities(): ModelCapabilities {
    return {
      transport: 'openai-compatible',
      structuredOutput: 'json_object',
      reasoning: 'unknown',
      toolCalls: 'native',
      ...this.options.capabilities,
    };
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
          ...(this.options.maxOutputTokens !== undefined ? { max_tokens: this.options.maxOutputTokens } : {}),
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
      const payload = await response.json() as OpenAiCompatibleResponsePayload;
      const envelope = normalizeOpenAiResponse(payload);
      this.recordUsage(envelope, started);
      const result = !envelope.finalText
        ? { isValid: false, errors: ['Model endpoint returned no final JSON content'] }
        : parseLlmRepairProposal(envelope.finalText);
      this.options.onResponse?.(createModelResponseDiagnostics(payload, envelope, 'proposal', result.errors, result.normalizationNotes ?? [], this.options.captureResponsePreview ?? false));
      return result;
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
          ...(this.options.maxOutputTokens !== undefined ? { max_tokens: this.options.maxOutputTokens } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: agentSystemPrompt() },
            { role: 'user', content: JSON.stringify({
              ...input,
              bundle: input.stepIndex === 0 ? input.bundle : compactAgentBundle(input.bundle),
            }) },
          ],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = await response.json() as OpenAiCompatibleResponsePayload;
      const envelope = normalizeOpenAiResponse(payload);
      this.recordUsage(envelope, started);
      const result = !envelope.finalText
        ? { isValid: false, errors: ['Model endpoint returned no final agent JSON content'] }
        : parseAgentResponse(envelope.finalText);
      this.options.onResponse?.(createModelResponseDiagnostics(payload, envelope, 'agent_step', result.errors, result.normalizationNotes ?? [], this.options.captureResponsePreview ?? false));
      return result;
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'Model request timed out' : 'Model request failed';
      return { isValid: false, errors: [message] };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordUsage(envelope: ModelResponseEnvelope, started: number): void {
    this.options.onUsage?.({
      provider: 'openai-compatible',
      model: this.options.model,
      inputTokens: envelope.usage?.inputTokens,
      outputTokens: envelope.usage?.outputTokens,
      totalTokens: envelope.usage?.totalTokens,
      durationMs: Date.now() - started,
    });
  }
}

/** Calls an Anthropic Messages-compatible endpoint without coupling PIE to an SDK. */
export class AnthropicCompatibleProposalProvider implements ProposalProvider, AgentStepProvider {
  private readonly options: AnthropicCompatibleProviderOptions;

  public constructor(options: AnthropicCompatibleProviderOptions) {
    this.options = options;
  }

  public getCapabilities(): ModelCapabilities {
    return {
      transport: 'anthropic-compatible',
      structuredOutput: 'prompt_only',
      reasoning: 'separate_channel',
      toolCalls: 'native',
      ...this.options.capabilities,
    };
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
          ...(this.options.maxTokens !== undefined ? { max_tokens: this.options.maxTokens } : {}),
          temperature: 0,
          system: proposalSystemPrompt(),
          messages: [{ role: 'user', content: JSON.stringify(bundle) }],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = await response.json() as AnthropicResponsePayload;
      const envelope = normalizeAnthropicResponse(payload);
      this.recordAnthropicUsage(envelope, started);
      const result = !envelope.finalText
        ? { isValid: false, errors: ['Model endpoint returned no final JSON content'] }
        : parseLlmRepairProposal(envelope.finalText);
      this.options.onResponse?.(createModelResponseDiagnostics(payload, envelope, 'proposal', result.errors, result.normalizationNotes ?? [], this.options.captureResponsePreview ?? false));
      return result;
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
          ...(this.options.maxTokens !== undefined ? { max_tokens: this.options.maxTokens } : {}),
          temperature: 0,
          system: agentSystemPrompt(),
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = await response.json() as AnthropicResponsePayload;
      const envelope = normalizeAnthropicResponse(payload);
      this.recordAnthropicUsage(envelope, started);
      const result = !envelope.finalText
        ? { isValid: false, errors: ['Model endpoint returned no final agent JSON content'] }
        : parseAgentResponse(envelope.finalText);
      this.options.onResponse?.(createModelResponseDiagnostics(payload, envelope, 'agent_step', result.errors, result.normalizationNotes ?? [], this.options.captureResponsePreview ?? false));
      return result;
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'Model request timed out' : 'Model request failed';
      return { isValid: false, errors: [message] };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordAnthropicUsage(envelope: ModelResponseEnvelope, started: number): void {
    const inputTokens = envelope.usage?.inputTokens;
    const outputTokens = envelope.usage?.outputTokens;
    const totalTokens = envelope.usage?.totalTokens;
    const estimatedCostUsd = inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) / 1_000_000 * (this.options.inputCostPerMillionTokens ?? 0) + (outputTokens ?? 0) / 1_000_000 * (this.options.outputCostPerMillionTokens ?? 0);
    this.options.onUsage?.({ provider: 'anthropic-compatible', model: this.options.model, inputTokens, outputTokens, totalTokens, estimatedCostUsd, durationMs: Date.now() - started });
  }
}

function proposalSystemPrompt(): string {
  return 'Return exactly one JSON object and nothing else. Do not use Markdown, code fences, or chain-of-thought. Use exactly these required top-level keys: proposalVersion:"1", decision:"PROPOSE" or "ABSTAIN", failureKind, confidence (0..1), reasoningSummary (short), operations (array of PIE allowlisted operations), requiredVerification (string array), and evidenceReferences (string array). For replace_locator use only kind, target, locator, and optional reason. The replace_locator target must be exactly the failed selector string from diagnostic.failedAction.selector, never a callId, source location, property name, or file path. The locator must be a complete PIE expression rooted at page. or this.page. (for example page.getByRole(...) or this.page.locator(...)). Do not return filePath, line, column, oldText, newText, patches, source code, or extra keys. If evidence is insufficient, return decision ABSTAIN with one abstain operation.';
}

function agentSystemPrompt(): string {
  return 'Return exactly one JSON object and nothing else. Do not use Markdown, code fences, or chain-of-thought. Use protocolVersion "2" and no extra keys. For STEP, include every required key: responseType:"STEP", status:"CONTINUE", decision (one of INSPECT_EVIDENCE, INSPECT_BROWSER_STATE, DISCOVER_SOURCE_MAPPING, RANK_LOCATOR_CANDIDATES, BUILD_REPAIR_PROPOSAL, VERIFY_REPAIR, ABSTAIN), confidence (number 0..1), reasoningSummary (short summary), evidenceReferences (string array), action (an object exactly like {"kind":"inspect_evidence"}; action must never be a string; kind must be one of inspect_evidence, inspect_browser_state, discover_source_mapping, rank_locator_candidates, build_repair_proposal, verify_repair, abstain), and requiredObservation (short string). For FINAL, include every required key: responseType:"FINAL", status (PROPOSAL_READY, VERIFIED_READY_FOR_APPROVAL, ABSTAIN, BLOCKED, or REJECTED), classification:{category,confidence}, reasoningSummary, evidenceReferences, and humanApprovalRequired:boolean. Include proposal only for a valid proposal and use proposalVersion:"1", decision PROPOSE or ABSTAIN, failureKind, confidence, reasoningSummary, operations, requiredVerification, and evidenceReferences. Every operation must use only the PIE allowlisted repair schema. If evidence is insufficient, return FINAL ABSTAIN. Keep summaries concise and never invent tools, source edits, file paths, or unsupported fields.';
}

function compactAgentBundle(bundle: EvidenceBundle): EvidenceBundle {
  const clip = (value: string | undefined, limit: number): string | undefined => {
    if (value === undefined || value.length <= limit) return value;
    return `${value.slice(0, limit)}\n[PIE evidence clipped after ${limit} characters]`;
  };
  const diagnostic = bundle.diagnostic;
  return {
    ...bundle,
    sourceContext: bundle.sourceContext.map((source) => ({ ...source, content: clip(source.content, 2500) ?? '' })),
    diagnostic: diagnostic ? {
      ...diagnostic,
      failedAction: {
        ...diagnostic.failedAction,
        errorStack: clip(diagnostic.failedAction.errorStack, 2500),
        logs: diagnostic.failedAction.logs?.slice(0, 20).map((log) => clip(log, 500) ?? ''),
      },
      snapshots: {
        before: clip(diagnostic.snapshots.before, 5000),
        action: clip(diagnostic.snapshots.action, 7000),
        after: clip(diagnostic.snapshots.after, 5000),
      },
      networkEvents: diagnostic.networkEvents.slice(0, 20),
      consoleEvents: diagnostic.consoleEvents.slice(0, 20).map((event) => ({ ...event, text: clip(event.text, 500) ?? '' })),
    } : undefined,
    limitations: [...new Set([...bundle.limitations, 'Evidence was compacted after the first agent step'])],
  };
}

