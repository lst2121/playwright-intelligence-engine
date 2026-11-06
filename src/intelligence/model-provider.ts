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

