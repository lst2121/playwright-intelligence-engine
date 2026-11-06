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
  usage?: ModelUsageEnvelope;
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
  return {
    finalText: finalText || undefined,
    reasoningText: message?.reasoning_content ?? undefined,
    toolCalls: message?.tool_calls,
    usage: payload.usage,
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
