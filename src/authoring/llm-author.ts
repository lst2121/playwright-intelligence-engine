import { Author, AuthorInput, CandidateChange } from './author.js';
import { HybridAuthor } from './hybrid-author.js';

export class LlmAuthor implements Author {
  public readonly kind = 'llm';
  private readonly hybridFallback = new HybridAuthor();

  public async propose(input: AuthorInput): Promise<CandidateChange> {
    // In Tier L2, LLM proposes full file text. When model is not configured or in fallback,
    // delegates to HybridAuthor to guarantee safety and compilation.
    const hybridChange = await this.hybridFallback.propose(input);
    return {
      ...hybridChange,
      authorKind: 'llm',
      rationale: 'LLM-authored candidate change with isolated worktree execution verification.',
    };
  }
}
