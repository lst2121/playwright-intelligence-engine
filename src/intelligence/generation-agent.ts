import { z } from 'zod';
import { ArchitectureGenerationInput, ArchitecturePlan, planArchitecture, writeArchitecturePlan, ArchitectureWriteResult } from '../generator/architecture-generator.js';
import { GeneratedStep } from '../generator/test-generator.js';
import { buildRepositoryProfile, RepositoryConventionProfile } from './repository-profile.js';
import { buildTestIntelligencePlan, ExistingTestInput, RequirementInput, TestIntelligencePlan } from './test-intelligence.js';
import { ExecutionRunner, ExecutionResult } from '../sandbox/execution-runner.js';
import { Author, AuthorKind, CandidateChange, TemplateAuthor, HybridAuthor, LlmAuthor } from '../authoring/index.js';
import { QualityGate, QualityGateResult } from '../gate/index.js';

const GeneratedStepSchema = z.object({
  action: z.enum(['click', 'fill', 'navigate', 'assert-visible', 'assert-text']),
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  value: z.string().optional(),
  expectedText: z.string().optional(),
}).strict();

const GeneratedScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  requirementId: z.string().min(1),
  steps: z.array(GeneratedStepSchema).min(1).max(100),
  reasoningSummary: z.string().min(1),
  evidenceReferences: z.array(z.string()),
}).strict();

export const GenerationPlanSchema = z.object({
  planVersion: z.literal('1'),
  status: z.enum(['GENERATE', 'NEEDS_INPUT', 'ABSTAIN']),
  reasoningSummary: z.string().min(1),
  scenarios: z.array(GeneratedScenarioSchema).max(30),
  requiredClarifications: z.array(z.string()),
  evidenceReferences: z.array(z.string()),
}).strict();

export type GenerationPlan = z.infer<typeof GenerationPlanSchema>;

export interface GenerationPlanInput {
  requirements: RequirementInput[];
  existingTests?: ExistingTestInput[] | undefined;
  mode: 'greenfield' | 'brownfield';
  repositoryProfile?: RepositoryConventionProfile | undefined;
  baseUrl?: string | undefined;
  suggestedSteps?: GeneratedStep[] | undefined;
}

export interface GenerationPlanProvider {
  propose(input: GenerationPlanInput, intelligence: TestIntelligencePlan): Promise<GenerationPlanParseResult>;
}

export interface GenerationPlanParseResult {
  isValid: boolean;
  plan?: GenerationPlan | undefined;
  errors: string[];
}

export interface GenerationAgentInput extends GenerationPlanInput {
  workspaceRoot?: string | undefined;
  provider?: GenerationPlanProvider | undefined;
  authorImpl?: Author | undefined;
  write?: boolean | undefined;
  existingFiles?: string[] | undefined;
  includeCi?: boolean | undefined;
  verify?: boolean | undefined;
  author?: AuthorKind | undefined;
  maxSteps?: number | undefined;
  maxDurationMs?: number | undefined;
}

export interface GeneratedScenarioResult {
  scenario: GenerationPlan['scenarios'][number];
  architecture: ArchitecturePlan;
  writeResult?: ArchitectureWriteResult | undefined;
  verification?: ExecutionResult | undefined;
  loopState?: 'SUCCESS' | 'AGENT_NO_PROGRESS' | 'AGENT_TIME_BUDGET' | 'MAX_STEPS_EXCEEDED' | undefined;
  stepsCount?: number | undefined;
  qualityGateResult?: QualityGateResult | undefined;
}

export interface GenerationAgentResult {
  status: 'MODEL_NOT_CONFIGURED' | 'ABSTAINED' | 'NEEDS_INPUT' | 'PLANNED' | 'WRITTEN' | 'VERIFIED' | 'VERIFICATION_FAILED' | 'AGENT_NO_PROGRESS';
  provider: 'llm' | 'deterministic-fallback';
  authorKind?: AuthorKind | undefined;
  intelligence: TestIntelligencePlan;
  plan?: GenerationPlan | undefined;
  scenarios: GeneratedScenarioResult[];
  errors: string[];
}

function parseJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const fenced = input.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced ?? input).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate);
}

export function parseGenerationPlan(input: unknown): GenerationPlanParseResult {
  try {
    const parsed = GenerationPlanSchema.safeParse(parseJson(input));
    if (!parsed.success) return { isValid: false, errors: parsed.error.issues.map((issue) => issue.message) };
    if (parsed.data.status === 'GENERATE' && parsed.data.scenarios.length === 0) {
      return { isValid: false, errors: ['GENERATE plans must contain at least one scenario'] };
    }
    if (parsed.data.status === 'NEEDS_INPUT' && parsed.data.requiredClarifications.length === 0) {
      return { isValid: false, errors: ['NEEDS_INPUT plans must include requiredClarifications'] };
    }
    return { isValid: true, plan: parsed.data, errors: [] };
  } catch (error) {
    return { isValid: false, errors: [`Generation response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function generationSystemPrompt(): string {
  return 'Return exactly one JSON object conforming to the schema:\n' +
    '{\n' +
    '  "planVersion": "1",\n' +
    '  "status": "GENERATE",\n' +
    '  "reasoningSummary": "string",\n' +
    '  "scenarios": [\n' +
    '    {\n' +
    '      "id": "scenario-1",\n' +
    '      "title": "string",\n' +
    '      "requirementId": "string",\n' +
    '      "steps": [\n' +
    '        { "action": "navigate", "value": "/url" },\n' +
    '        { "action": "fill", "role": "textbox", "name": "Field", "value": "val" },\n' +
    '        { "action": "click", "role": "button", "name": "Button" },\n' +
    '        { "action": "assert-text", "role": "status", "name": "Label", "expectedText": "Expected" }\n' +
    '      ],\n' +
    '      "reasoningSummary": "string",\n' +
    '      "evidenceReferences": []\n' +
    '    }\n' +
    '  ],\n' +
    '  "requiredClarifications": [],\n' +
    '  "evidenceReferences": []\n' +
    '}\n' +
    'Steps may only use click, fill, navigate, assert-visible, or assert-text. Every scenario MUST contain at least one step in its steps array. Do not return raw code, patches, or unsupported fields.';
}

export interface OpenAiCompatibleGenerationProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/** Provider-neutral boundary with an OpenAI-compatible transport implementation. */
export class OpenAiCompatibleGenerationProvider implements GenerationPlanProvider {
  public constructor(private readonly options: OpenAiCompatibleGenerationProviderOptions) {}

  public async propose(input: GenerationPlanInput, intelligence: TestIntelligencePlan): Promise<GenerationPlanParseResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
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
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: generationSystemPrompt() },
            { role: 'user', content: JSON.stringify({ input, intelligence }) },
          ],
        }),
      });
      if (!response.ok) return { isValid: false, errors: [`Model endpoint returned HTTP ${response.status}`] };
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> | null } }>; output_text?: string };
      const content = payload.output_text
        ?? (typeof payload.choices?.[0]?.message?.content === 'string'
          ? payload.choices[0].message.content
          : payload.choices?.[0]?.message?.content?.map((part) => part.text ?? '').join(''));
      if (!content) return { isValid: false, errors: ['Model endpoint returned no generation plan content'] };
      return parseGenerationPlan(content);
    } catch (error) {
      return { isValid: false, errors: [error instanceof Error && error.name === 'AbortError' ? 'Generation model request timed out' : `Generation model request failed: ${error instanceof Error ? error.message : String(error)}`] };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function configuredGenerationProvider(): GenerationPlanProvider | undefined {
  const apiKey = process.env.PIE_LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const endpoint = process.env.PIE_LLM_ENDPOINT ?? (apiKey ? 'https://api.deepseek.com/chat/completions' : undefined);
  const model = process.env.PIE_LLM_MODEL ?? (apiKey ? 'deepseek-chat' : undefined);
  if (!endpoint || !model) return undefined;
  return new OpenAiCompatibleGenerationProvider({
    endpoint,
    model,
    ...(apiKey ? { apiKey } : {}),
  });
}

function validateGeneratedScenario(
  scenario: GenerationPlan['scenarios'][number],
  requirementIds: Set<string>,
): string[] {
  const errors: string[] = [];
  if (!requirementIds.has(scenario.requirementId)) errors.push(`Scenario '${scenario.id}' references unknown requirement '${scenario.requirementId}'`);
  for (const [index, step] of scenario.steps.entries()) {
    const hasSemanticTarget = step.action === 'fill'
      ? Boolean(step.name || (step.role && step.name))
      : Boolean(step.role && step.name);
    const hasExplicitTarget = Boolean(step.selector);
    if ((step.action === 'click' || step.action === 'fill') && !hasSemanticTarget && !hasExplicitTarget) {
      errors.push(`Scenario '${scenario.id}' step ${index + 1} requires role/name or an explicit selector`);
    }
    if (step.action === 'assert-visible' && !hasSemanticTarget && !hasExplicitTarget) {
      errors.push(`Scenario '${scenario.id}' visibility assertion requires role/name or an explicit selector`);
    }
    if (step.action === 'assert-text') {
      const text = step.expectedText?.trim() || step.value?.trim();
      if (!text) {
        errors.push(`Scenario '${scenario.id}' text assertion requires expectedText or value`);
      } else if (!step.expectedText) {
        step.expectedText = text;
      }
    }
  }
  return errors;
}

export async function runGenerationAgent(input: GenerationAgentInput): Promise<GenerationAgentResult> {
  const intelligence = buildTestIntelligencePlan(input.requirements, input.existingTests ?? []);
  const profile = input.repositoryProfile ?? (input.mode === 'brownfield' ? await buildRepositoryProfile(input.workspaceRoot ?? process.cwd()) : undefined);
  const provider = input.provider ?? configuredGenerationProvider();
  if (input.verify === true && input.write !== true) {
    return { status: 'ABSTAINED', provider: provider ? 'llm' : 'deterministic-fallback', intelligence, scenarios: [], errors: ['Generation verification requires --write so the generated spec exists in the target workspace'] };
  }

  let generatedPlan: GenerationPlan;
  let providerMode: 'llm' | 'deterministic-fallback' = 'llm';
  if (provider) {
    const response = await provider.propose({
      requirements: input.requirements,
      existingTests: input.existingTests,
      mode: input.mode,
      repositoryProfile: profile,
      baseUrl: input.baseUrl,
      suggestedSteps: input.suggestedSteps,
    }, intelligence);
    if (!response.isValid || !response.plan) return { status: 'ABSTAINED', provider: 'llm', intelligence, scenarios: [], errors: response.errors };
    if (response.plan.status === 'ABSTAIN') return { status: 'ABSTAINED', provider: 'llm', intelligence, plan: response.plan, scenarios: [], errors: [response.plan.reasoningSummary] };
    if (response.plan.status === 'NEEDS_INPUT') return { status: 'NEEDS_INPUT', provider: 'llm', intelligence, plan: response.plan, scenarios: [], errors: response.plan.requiredClarifications };
    generatedPlan = response.plan;
  } else {
    providerMode = 'deterministic-fallback';
    generatedPlan = {
      planVersion: '1',
      status: 'GENERATE',
      reasoningSummary: 'No LLM provider is configured; generated a conservative deterministic scaffold from the supplied requirements.',
      scenarios: input.requirements.map((requirement) => ({
        id: `scenario-${requirement.id}`,
        title: requirement.title,
        requirementId: requirement.id,
        steps: input.suggestedSteps && input.suggestedSteps.length > 0
          ? input.suggestedSteps
          : [{ action: 'navigate' as const }, { action: 'assert-visible' as const, role: 'heading', name: requirement.title }],
        reasoningSummary: 'Scenario derived directly from the supplied requirement; business assertions require review.',
        evidenceReferences: [`requirement:${requirement.id}`],
      })),
      requiredClarifications: [],
      evidenceReferences: input.requirements.map((requirement) => `requirement:${requirement.id}`),
    };
  }

  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const scenarioIds = new Set<string>();
  const scenarioValidationErrors = generatedPlan.scenarios.flatMap((scenario) => {
    const errors = scenarioIds.has(scenario.id) ? [`Duplicate generated scenario id '${scenario.id}'`] : [];
    scenarioIds.add(scenario.id);
    return [...errors, ...validateGeneratedScenario(scenario, requirementIds)];
  });
  if (scenarioValidationErrors.length > 0) {
    return { status: 'ABSTAINED', provider: providerMode, intelligence, plan: generatedPlan, scenarios: [], errors: scenarioValidationErrors };
  }

  const authorKind: AuthorKind = input.author ?? 'hybrid';
  const author: Author = input.authorImpl ?? (
    authorKind === 'template'
      ? new TemplateAuthor()
      : authorKind === 'llm'
        ? new LlmAuthor()
        : new HybridAuthor()
  );

  const scenarios: GeneratedScenarioResult[] = [];
  for (const scenario of generatedPlan.scenarios) {
    const maxSteps = input.maxSteps ?? 3;
    const maxDurationMs = input.maxDurationMs ?? 120_000;
    const startTime = Date.now();
    const seenSignatures = new Set<string>();

    let candidate: CandidateChange | undefined;
    let gateResult: QualityGateResult | undefined;
    let loopState: 'SUCCESS' | 'AGENT_NO_PROGRESS' | 'AGENT_TIME_BUDGET' | 'MAX_STEPS_EXCEEDED' = 'SUCCESS';
    let stepCount = 0;

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      stepCount++;
      if (Date.now() - startTime >= maxDurationMs) {
        loopState = 'AGENT_TIME_BUDGET';
        break;
      }

      candidate = await author.propose({
        featureName: scenario.title,
        mode: input.mode,
        baseUrl: input.baseUrl,
        requirements: input.requirements.find((r) => r.id === scenario.requirementId)?.description
          ?? input.requirements.find((r) => r.id === scenario.requirementId)?.title,
        steps: scenario.steps as GeneratedStep[],
        profile,
        existingFiles: input.existingFiles,
        exemplars: profile?.exemplars,
      });

      gateResult = QualityGate.evaluate({
        symbols: candidate.symbols,
        files: candidate.files,
        locatorPolicy: profile?.identifierConventions?.recommendedLocatorPolicy,
      });

      const signature = `${candidate.symbols.pageClassName}:${candidate.symbols.symbols.map((s) => `${s.property}:${s.method}`).join(',')}:${gateResult.violations.join(';')}`;

      if (seenSignatures.has(signature)) {
        loopState = 'AGENT_NO_PROGRESS';
        break;
      }
      seenSignatures.add(signature);

      if (gateResult.passed) {
        loopState = 'SUCCESS';
        break;
      }

      if (stepIndex === maxSteps - 1) {
        loopState = 'MAX_STEPS_EXCEEDED';
      }
    }

    const architectureInput: ArchitectureGenerationInput = {
      featureName: scenario.title,
      mode: input.mode,
      baseUrl: input.baseUrl,
      requirements: input.requirements.find((requirement) => requirement.id === scenario.requirementId)?.description
        ?? input.requirements.find((requirement) => requirement.id === scenario.requirementId)?.title,
      steps: scenario.steps as GeneratedStep[],
      profile,
      existingFiles: input.existingFiles,
      includeCi: input.includeCi,
      namePlan: candidate?.symbols,
    };
    const architecture = planArchitecture(architectureInput);

    const writeResult = (input.write === true && loopState === 'SUCCESS')
      ? await writeArchitecturePlan(input.workspaceRoot ?? process.cwd(), architecture)
      : undefined;

    let verification: ExecutionResult | undefined;
    if (input.verify === true && loopState === 'SUCCESS') {
      const spec = architecture.files.find((file) => file.relativePath.endsWith('.spec.ts'));
      if (!spec) throw new Error(`Generated scenario '${scenario.id}' did not produce a spec file`);
      verification = await ExecutionRunner.run('npx', {
        cwd: input.workspaceRoot ?? process.cwd(),
        args: ['playwright', 'test', spec.relativePath, '--reporter=line'],
        timeoutMs: 120_000,
      });
    }

    scenarios.push({
      scenario,
      architecture,
      ...(writeResult ? { writeResult } : {}),
      ...(verification ? { verification } : {}),
      loopState,
      stepsCount: stepCount,
      ...(gateResult ? { qualityGateResult: gateResult } : {}),
    });
  }

  const anyNoProgress = scenarios.some((s) => s.loopState === 'AGENT_NO_PROGRESS');
  const anyGateFailed = scenarios.some((s) => s.qualityGateResult && !s.qualityGateResult.passed);
  const anyVerificationFailed = scenarios.some((s) => s.verification && s.verification.exitCode !== 0);

  const errors: string[] = [];
  if (anyNoProgress) {
    errors.push('Generation agent detected no progress: author proposed duplicate invalid states.');
  }
  if (anyGateFailed) {
    errors.push(...scenarios.flatMap((s) => s.qualityGateResult?.violations ?? []));
  }

  let status: GenerationAgentResult['status'];
  if (anyNoProgress) {
    status = 'AGENT_NO_PROGRESS';
  } else if (anyGateFailed) {
    status = 'ABSTAINED';
  } else if (input.verify === true) {
    status = anyVerificationFailed ? 'VERIFICATION_FAILED' : 'VERIFIED';
  } else if (input.write === true) {
    status = 'WRITTEN';
  } else {
    status = 'PLANNED';
  }

  return {
    status,
    provider: providerMode,
    authorKind,
    intelligence,
    plan: generatedPlan,
    scenarios,
    errors,
  };
}
