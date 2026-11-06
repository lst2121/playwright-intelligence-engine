export type ModelTransport = 'openai-compatible' | 'anthropic-compatible' | 'local' | 'unknown';
export type StructuredOutputCapability = 'json_schema' | 'json_object' | 'prompt_only' | 'unknown';
export type ReasoningCapability = 'separate_channel' | 'inline' | 'unsupported' | 'unknown';
export type ToolCallCapability = 'native' | 'application_protocol' | 'unsupported' | 'unknown';

export interface ModelCapabilities {
  transport: ModelTransport;
  structuredOutput: StructuredOutputCapability;
  reasoning: ReasoningCapability;
  toolCalls: ToolCallCapability;
  maxOutputTokens?: number | undefined;
}

export interface ModelUsageEnvelope {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
}

/** Provider-neutral response shape consumed by PIE's agent protocol. */
export interface ModelResponseEnvelope {
  finalText?: string | undefined;
  reasoningText?: string | undefined;
  structuredOutput?: unknown;
  toolCalls?: unknown[] | undefined;
  usage?: ModelUsageEnvelope | undefined;
  finishReason?: string | undefined;
  transport: ModelTransport;
}

export type ModelRequestKind = 'proposal' | 'agent_step';

export interface ModelResponseDiagnostics {
  requestKind: ModelRequestKind;
  transport: ModelTransport;
  topLevelKeys: string[];
  choiceKeys: string[];
  messageKeys: string[];
  contentKind: 'string' | 'array' | 'missing' | 'null';
  hasFinalText: boolean;
  finalTextLength: number;
  reasoningTextLength: number;
  toolCallCount: number;
  finishReason?: string | undefined;
  usagePresent: boolean;
  candidateKeys: string[];
  candidateResponseType?: string | undefined;
  candidateStatus?: string | undefined;
  candidateDecision?: string | undefined;
  candidateActionKind?: string | undefined;
  candidateProposalVersion?: string | undefined;
  validationErrors: string[];
  normalizationNotes: string[];
  redactedPreview?: string | undefined;
}

export interface OpenAiCompatibleResponsePayload {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      reasoning_content?: string | null;
      tool_calls?: unknown[];
    };
  }>;
  output_text?: string;
  usage?: ModelUsageEnvelope & {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface AnthropicResponsePayload {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export function normalizeOpenAiResponse(payload: OpenAiCompatibleResponsePayload): ModelResponseEnvelope {
  const message = payload.choices?.[0]?.message;
  const content = message?.content;
  const finalText = typeof payload.output_text === 'string'
    ? payload.output_text
    : typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part.text ?? '').join('')
        : undefined;
  const inputTokens = payload.usage?.inputTokens ?? payload.usage?.prompt_tokens;
  const outputTokens = payload.usage?.outputTokens ?? payload.usage?.completion_tokens;
  const totalTokens = payload.usage?.totalTokens ?? payload.usage?.total_tokens
    ?? (inputTokens === undefined && outputTokens === undefined ? undefined : (inputTokens ?? 0) + (outputTokens ?? 0));
  return {
    finalText: finalText || undefined,
    reasoningText: message?.reasoning_content ?? undefined,
    toolCalls: message?.tool_calls,
    usage: inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
      ? undefined
      : { inputTokens, outputTokens, totalTokens },
    finishReason: payload.choices?.[0]?.finish_reason,
    transport: 'openai-compatible',
  };
}

export function normalizeAnthropicResponse(payload: AnthropicResponsePayload): ModelResponseEnvelope {
  const textParts = payload.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '') ?? [];
  const reasoningParts = payload.content?.filter((part) => part.type === 'thinking').map((part) => part.text ?? '') ?? [];
  const inputTokens = payload.usage?.input_tokens;
  const outputTokens = payload.usage?.output_tokens;
  return {
    finalText: textParts.join('') || undefined,
    reasoningText: reasoningParts.join('') || undefined,
    usage: inputTokens === undefined && outputTokens === undefined
      ? undefined
      : { inputTokens, outputTokens, totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) },
    finishReason: payload.stop_reason,
    transport: 'anthropic-compatible',
  };
}

function redactPreview(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]')
    .slice(0, 1000);
}

interface CandidateInspection {
  keys: string[];
  responseType?: string | undefined;
  status?: string | undefined;
  decision?: string | undefined;
  actionKind?: string | undefined;
  proposalVersion?: string | undefined;
}

function inspectCandidate(text: string | undefined): CandidateInspection {
  if (!text) return { keys: [] };
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidateText = (fenced ?? text).trim();
  const start = candidateText.indexOf('{');
  const end = candidateText.lastIndexOf('}');
  if (start < 0 || end <= start) return { keys: [] };
  try {
    const candidate = JSON.parse(candidateText.slice(start, end + 1)) as Record<string, unknown>;
    return {
      keys: Object.keys(candidate),
      responseType: typeof candidate.responseType === 'string' ? candidate.responseType : undefined,
      status: typeof candidate.status === 'string' ? candidate.status : undefined,
      decision: typeof candidate.decision === 'string' ? candidate.decision : undefined,
      actionKind: typeof (candidate.action as Record<string, unknown> | undefined)?.kind === 'string'
        ? String((candidate.action as Record<string, unknown>).kind)
        : undefined,
      proposalVersion: typeof candidate.proposalVersion === 'string' ? candidate.proposalVersion : undefined,
    };
  } catch {
    return { keys: [] };
  }
}

export function createModelResponseDiagnostics(
  payload: unknown,
  envelope: ModelResponseEnvelope,
  requestKind: ModelRequestKind,
  validationErrors: string[] = [],
  normalizationNotes: string[] = [],
  includePreview = false,
): ModelResponseDiagnostics {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const message = firstChoice.message && typeof firstChoice.message === 'object' ? firstChoice.message as Record<string, unknown> : {};
  const content = message.content;
  const contentKind = content === null ? 'null' : typeof content === 'string' ? 'string' : Array.isArray(content) ? 'array' : content === undefined ? 'missing' : 'missing';
  const candidate = inspectCandidate(envelope.finalText);
  const diagnostics: ModelResponseDiagnostics = {
    requestKind,
    transport: envelope.transport,
    topLevelKeys: Object.keys(record),
    choiceKeys: Object.keys(firstChoice),
    messageKeys: Object.keys(message),
    contentKind,
    hasFinalText: Boolean(envelope.finalText),
    finalTextLength: envelope.finalText?.length ?? 0,
    reasoningTextLength: envelope.reasoningText?.length ?? 0,
    toolCallCount: envelope.toolCalls?.length ?? 0,
    finishReason: envelope.finishReason,
    usagePresent: envelope.usage !== undefined,
    candidateKeys: candidate.keys,
    candidateResponseType: candidate.responseType,
    candidateStatus: candidate.status,
    candidateDecision: candidate.decision,
    candidateActionKind: candidate.actionKind,
    candidateProposalVersion: candidate.proposalVersion,
    validationErrors,
    normalizationNotes,
  };
  if (includePreview && envelope.finalText) diagnostics.redactedPreview = redactPreview(envelope.finalText);
  return diagnostics;
}
