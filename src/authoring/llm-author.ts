import { Project } from 'ts-morph';
import {
  Author,
  AuthorInput,
  CandidateChange,
  FullCodeGenerationInput,
  FullCodeGenerationProvider,
} from './author.js';
import { HybridAuthor } from './hybrid-author.js';
import {
  buildTierL2SystemPrompt,
  FullGenerationProposal,
  normalizeProposalPath,
  validateFullGenerationProposal,
} from './generation-contract.js';
import type { NamePlan, SymbolEntry } from './naming/name-plan.js';
import { NamePlanner } from './naming/name-planner.js';
import { toClassName, toSlug } from '../generator/architecture-generator.js';

export interface OpenAiCompatibleFullCodeProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Provider-neutral Tier-L2 full-code Playwright generation transport.
 */
export class OpenAiCompatibleFullCodeProvider implements FullCodeGenerationProvider {
  public constructor(private readonly options: OpenAiCompatibleFullCodeProviderOptions) {}

  public async generate(input: FullCodeGenerationInput): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 90_000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildTierL2SystemPrompt() },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Tier-L2 generation model endpoint returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> | null } }>;
        output_text?: string;
      };
      const content =
        payload.output_text ??
        (typeof payload.choices?.[0]?.message?.content === 'string'
          ? payload.choices[0].message.content
          : payload.choices?.[0]?.message?.content?.map((part) => part.text ?? '').join(''));
      if (!content) {
        throw new Error('Tier-L2 generation model returned empty content');
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function configuredFullCodeProvider(): FullCodeGenerationProvider | undefined {
  const liveAllowed = !process.env.VITEST || process.env.PIE_LIVE_LLM_TESTS === '1';
  if (!liveAllowed) return undefined;
  const apiKey = process.env.PIE_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const endpoint = process.env.PIE_LLM_ENDPOINT ?? (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1/chat/completions' : (apiKey ? 'https://api.deepseek.com/chat/completions' : undefined));
  const model = process.env.PIE_LLM_MODEL ?? (process.env.OPENAI_API_KEY ? 'gpt-4o' : (apiKey ? 'deepseek-chat' : undefined));
  if (!endpoint || !model) return undefined;
  return new OpenAiCompatibleFullCodeProvider({
    endpoint,
    model,
    ...(apiKey ? { apiKey } : {}),
  });
}

function inferRoleSuffix(propertyName: string): string {
  const lower = propertyName.toLowerCase();
  if (lower.includes('input') || lower.includes('field')) return 'textbox';
  if (lower.includes('button') || lower.includes('btn')) return 'button';
  if (lower.includes('checkbox')) return 'checkbox';
  if (lower.includes('select')) return 'combobox';
  return 'locator';
}

function extractNamePlanFromGeneratedFiles(featureName: string, proposal: FullGenerationProposal): NamePlan {
  const rawBase = toClassName(featureName);
  let pageClassName = rawBase.endsWith('Page') ? rawBase : `${rawBase}Page`;
  const symbols: SymbolEntry[] = [];

  try {
    const project = new Project({ useInMemoryFileSystem: true });
    for (const file of proposal.files) {
      if (!/\.tsx?$/i.test(file.path)) continue;
      const sf = project.createSourceFile(file.path, file.content, { overwrite: true });
      const classes = sf.getClasses();
      const pageClass = classes.find((c) => c.getName()?.endsWith('Page')) ?? classes[0];
      if (!pageClass) continue;
      const clsName = pageClass.getName();
      if (clsName) {
        pageClassName = clsName.endsWith('Page') ? clsName : `${clsName}Page`;
      }
      const props = pageClass
        .getProperties()
        .map((p) => p.getName())
        .filter((p) => p !== 'page');
      const methods = pageClass.getMethods().filter((m) => m.getName() !== 'goto');
      const usedPropNames = new Set<string>();

      for (let i = 0; i < methods.length; i += 1) {
        const methodDecl = methods[i]!;
        const method = methodDecl.getName();
        const bodyText = methodDecl.getBodyText() ?? '';
        const matchedProp = props.find((p) => !usedPropNames.has(p) && new RegExp(`\\bthis\\.${p}\\b`).test(bodyText));
        const property = matchedProp ?? `${method}Locator`;
        usedPropNames.add(property);
        const verbMatch = method.match(/^([a-z]+)/);
        symbols.push({
          ref: `ast-${i + 1}`,
          role: inferRoleSuffix(property),
          property,
          method,
          verb: verbMatch?.[1] ?? 'click',
          confidence: 0.9,
          source: 'llm',
          assumptions: [],
        });
      }
      if (symbols.length > 0) break;
    }
  } catch {
    // Fallback below if AST extraction fails
  }

  const pageVariable = pageClassName[0]!.toLowerCase() + pageClassName.slice(1);
  return {
    planVersion: '1',
    pageClassName,
    pageVariable,
    symbols,
    assumptions: proposal.assumptions.map((a) => a.description),
  };
}

export interface LlmAuthorOptions {
  provider?: FullCodeGenerationProvider | undefined;
}

export class LlmAuthor implements Author {
  public readonly kind = 'llm';
  private readonly hybridFallback = new HybridAuthor();

  public constructor(private readonly options: LlmAuthorOptions = {}) {}

  public async propose(input: AuthorInput): Promise<CandidateChange> {
    const provider = input.fullCodeProvider ?? this.options.provider ?? configuredFullCodeProvider();
    if (!provider) {
      const hybridChange = await this.hybridFallback.propose(input);
      return {
        ...hybridChange,
        authorKind: 'llm',
        fullCodeAuthoring: false,
        usedFallback: true,
        status: 'GENERATE',
        rationale: 'No Tier-L2 full-code provider configured; fell back to deterministic HybridAuthor.',
      };
    }

    const generationInput: FullCodeGenerationInput = {
      featureName: input.featureName,
      mode: input.mode,
      baseUrl: input.baseUrl,
      requirements: input.requirements,
      steps: input.steps,
      profile: input.profile,
      existingFiles: input.existingFiles,
      exemplars: input.exemplars,
      contextPacket: input.contextPacket,
      workflowPlan: input.workflowPlan,
      explorationBundle: input.explorationBundle,
      scenarios: input.scenarios,
      existingFileSnapshots: input.existingFileSnapshots,
      allowedEvidenceIds: input.allowedEvidenceIds,
      feedback: input.feedback,
    };

    let rawProposal: unknown;
    try {
      rawProposal = await provider.generate(generationInput);
    } catch (error) {
      const hybridChange = await this.hybridFallback.propose(input);
      return {
        ...hybridChange,
        authorKind: 'llm',
        fullCodeAuthoring: false,
        usedFallback: true,
        status: 'GENERATE',
        validationErrors: [`Tier-L2 provider failed (${error instanceof Error ? error.message : String(error)}); fell back to HybridAuthor.`],
        rationale: `Tier-L2 provider unavailable; fell back to HybridAuthor (${error instanceof Error ? error.message : String(error)}).`,
      };
    }

    const validation = validateFullGenerationProposal(rawProposal, {
      allowedEvidenceIds: input.allowedEvidenceIds ? new Set(input.allowedEvidenceIds) : undefined,
      existingFiles: input.existingFiles ? new Set(input.existingFiles) : undefined,
      requireEvidenceReferences: input.requireEvidenceReferences,
    });

    if (!validation.isValid || !validation.proposal) {
      return {
        files: [],
        symbols: NamePlanner.planNames(input.featureName, input.steps ?? [], { source: 'llm' }),
        rationale: `Tier-L2 proposal rejected by contract validation: ${validation.errors.join('; ')}`,
        authorKind: 'llm',
        featureName: input.featureName,
        slug: toSlug(input.featureName),
        mode: input.mode,
        status: 'ABSTAIN',
        fullCodeAuthoring: true,
        usedFallback: false,
        validationErrors: validation.errors,
      };
    }

    const proposal = validation.proposal;
    if (proposal.status !== 'GENERATE') {
      return {
        files: [],
        symbols: NamePlanner.planNames(input.featureName, input.steps ?? [], { source: 'llm' }),
        rationale: proposal.summary,
        authorKind: 'llm',
        featureName: input.featureName,
        slug: toSlug(input.featureName),
        mode: input.mode,
        status: proposal.status,
        fullCodeAuthoring: true,
        usedFallback: false,
        proposal,
        assumptions: proposal.assumptions.map((a) => a.description),
        requiredClarifications: proposal.requiredClarifications,
      };
    }

    const symbols = extractNamePlanFromGeneratedFiles(input.featureName, proposal);
    return {
      files: proposal.files.map((f) => ({
        relativePath: normalizeProposalPath(f.path),
        content: f.content,
        purpose: f.rationale,
        action: f.action === 'modify' ? 'MODIFY' : 'CREATE',
        rationale: f.rationale,
        evidenceReferences: f.evidenceReferences,
        scenarioIds: f.scenarioIds,
      })),
      symbols,
      rationale: proposal.summary,
      authorKind: 'llm',
      featureName: input.featureName,
      slug: toSlug(input.featureName),
      mode: input.mode,
      status: 'GENERATE',
      fullCodeAuthoring: true,
      usedFallback: false,
      proposal,
      assumptions: proposal.assumptions.map((a) => a.description),
    };
  }
}
