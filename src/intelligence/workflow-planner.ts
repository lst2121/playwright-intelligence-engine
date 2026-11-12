import crypto from 'node:crypto';
import { z } from 'zod';
import { toSlug } from '../generator/architecture-generator.js';
import { extractBusinessIntent } from './business-intent.js';
import { ExistingTestInput, RequirementInput } from './test-intelligence.js';

export const WorkflowProvenanceSchema = z.enum([
  'explicit-requirement',
  'source-derived',
  'diff-derived',
  'assumption',
]);
export type WorkflowProvenance = z.infer<typeof WorkflowProvenanceSchema>;

export const WorkflowScenarioCategorySchema = z.enum([
  'happy-path',
  'negative',
  'validation',
  'required-fields',
  'boundary',
  'persistence',
  'authentication',
  'authorization',
  'state-transition',
  'error-handling',
  'recovery',
  'ui-api-consistency',
]);
export type WorkflowScenarioCategory = z.infer<typeof WorkflowScenarioCategorySchema>;

export const WorkflowStepSchema = z.object({
  keyword: z.enum(['Given', 'When', 'And', 'Then', 'But']),
  text: z.string().min(1),
  actionHint: z.string().optional(),
  targetHint: z.string().optional(),
  valueHint: z.string().optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const NormalizedRequirementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
  provenance: WorkflowProvenanceSchema,
  risk: z.enum(['critical', 'high', 'medium', 'low', 'unknown']),
  ambiguous: z.boolean().default(false),
  clarificationsNeeded: z.array(z.string()).default([]),
  sourceRef: z.string().optional(),
});
export type NormalizedRequirement = z.infer<typeof NormalizedRequirementSchema>;

export const PlannedWorkflowScenarioSchema = z.object({
  id: z.string().min(1),
  requirementRefs: z.array(z.string()).min(1),
  title: z.string().min(1),
  category: WorkflowScenarioCategorySchema,
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  tags: z.array(z.string()).default([]),
  provenance: WorkflowProvenanceSchema,
  applicability: z.enum(['applicable', 'covered', 'not_applicable', 'needs_clarification']),
  preconditions: z.array(z.string()).default([]),
  steps: z.array(WorkflowStepSchema).min(1),
  expectedOutcomes: z.array(z.string()).default([]),
  evidenceRequirements: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()).default([]),
});
export type PlannedWorkflowScenario = z.infer<typeof PlannedWorkflowScenarioSchema>;

export const GenerationWorkflowPlanSchema = z.object({
  planVersion: z.literal('1.0').default('1.0'),
  featureName: z.string().min(1),
  slug: z.string().min(1),
  createdAt: z.string(),
  planHash: z.string().min(1),
  background: z.array(z.string()).default([]),
  inputs: z.array(z.object({
    kind: z.enum(['prompt', 'markdown', 'text', 'json', 'feature', 'git-diff', 'source', 'jira']),
    reference: z.string(),
  })).default([]),
  requirements: z.array(NormalizedRequirementSchema),
  scenarios: z.array(PlannedWorkflowScenarioSchema),
  unresolvedQuestions: z.array(z.string()).default([]),
  diffSummary: z.object({
    changedFiles: z.array(z.string()).default([]),
    changedRoutes: z.array(z.string()).default([]),
    apiEndpoints: z.array(z.string()).default([]),
    validationHints: z.array(z.string()).default([]),
  }).optional(),
});
export type GenerationWorkflowPlan = z.infer<typeof GenerationWorkflowPlanSchema>;

export interface SourceAnalysisHints {
  routes?: string[] | undefined;
  validationRules?: string[] | undefined;
  apiEndpoints?: string[] | undefined;
  authRequired?: boolean | undefined;
  persistenceDetected?: boolean | undefined;
}

export interface GitDiffHintsInput {
  changedFiles?: string[] | undefined;
  changedRoutes?: string[] | undefined;
  changedSymbols?: string[] | undefined;
  apiEndpoints?: string[] | undefined;
  validationHints?: string[] | undefined;
  recentCommits?: Array<{ hash: string; subject: string }> | undefined;
}

export interface WorkflowPlanInput {
  featureName?: string | undefined;
  prompt?: string | undefined;
  markdown?: string | undefined;
  text?: string | undefined;
  jsonRequirements?: unknown;
  featureText?: string | undefined;
  jiraIssue?: { key?: string | undefined; summary: string; description?: string | undefined; acceptanceCriteria?: string[] | undefined } | undefined;
  requirements?: RequirementInput[] | undefined;
  existingTests?: ExistingTestInput[] | undefined;
  gitDiff?: GitDiffHintsInput | undefined;
  sourceHints?: SourceAnalysisHints | undefined;
  baseUrl?: string | undefined;
  now?: Date | undefined;
}

export interface GherkinImportResult {
  success: boolean;
  plan?: GenerationWorkflowPlan | undefined;
  edited: boolean;
  addedScenarioIds: string[];
  removedScenarioIds: string[];
  modifiedScenarioIds: string[];
  errors: string[];
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

export function computeWorkflowPlanHash(plan: Omit<GenerationWorkflowPlan, 'planHash' | 'createdAt'>): string {
  return stableHash({
    featureName: plan.featureName,
    background: plan.background,
    requirements: plan.requirements,
    scenarios: plan.scenarios,
  });
}

function parseMarkdownRequirements(markdown: string, fallbackTitle: string): {
  featureName: string;
  requirements: NormalizedRequirement[];
} {
  const lines = markdown.split(/\r?\n/);
  let featureName = fallbackTitle;
  const headings: string[] = [];
  const bullets: string[] = [];
  const prose: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 && headings.length === 0) {
      featureName = h1[1]!.trim();
      headings.push(featureName);
      continue;
    }
    const hx = line.match(/^#{2,4}\s+(.+)$/);
    if (hx) {
      headings.push(hx[1]!.trim());
      continue;
    }
    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]!.trim());
      continue;
    }
    prose.push(line);
  }

  const intent = extractBusinessIntent({ id: 'md-1', title: featureName, sourceText: markdown });
  const isAmbiguous = bullets.length === 0 && prose.join(' ').trim().split(/\s+/).length < 4;

  const requirements: NormalizedRequirement[] = bullets.length > 0
    ? bullets.map((ac, idx) => ({
        id: `REQ-${idx + 1}`,
        title: ac.length > 80 ? `${ac.slice(0, 77)}...` : ac,
        description: ac,
        acceptanceCriteria: [ac],
        provenance: 'explicit-requirement',
        risk: extractBusinessIntent({ id: `REQ-${idx + 1}`, sourceText: ac }).risk,
        ambiguous: false,
        clarificationsNeeded: [],
        sourceRef: 'markdown',
      }))
    : [{
        id: 'REQ-1',
        title: featureName,
        description: prose.join(' ') || featureName,
        acceptanceCriteria: prose.length > 0 ? [prose.join(' ')] : [],
        provenance: 'explicit-requirement',
        risk: intent.risk,
        ambiguous: isAmbiguous,
        clarificationsNeeded: isAmbiguous
          ? [`Requirement '${featureName}' has no acceptance criteria or observable expected outcomes.`]
          : [],
        sourceRef: 'markdown',
      }];

  return { featureName, requirements };
}

function parseJsonRequirements(raw: unknown, fallbackTitle: string): NormalizedRequirement[] {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    data = JSON.parse(raw);
  }
  const list = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as any).requirements))
      ? (data as any).requirements
      : data && typeof data === 'object'
        ? [data]
        : [];

  return list.map((item: any, idx: number) => {
    const id = String(item?.id ?? `REQ-${idx + 1}`);
    const title = String(item?.title ?? item?.summary ?? fallbackTitle).trim() || fallbackTitle;
    const description = String(item?.description ?? title).trim();
    const acList: string[] = Array.isArray(item?.acceptanceCriteria)
      ? item.acceptanceCriteria.map(String).filter(Boolean)
      : description !== title ? [description] : [];
    const intent = extractBusinessIntent({ id, title, sourceText: `${title}\n${description}\n${acList.join('\n')}` });
    return {
      id,
      title,
      description,
      acceptanceCriteria: acList,
      provenance: 'explicit-requirement',
      risk: intent.risk,
      ambiguous: acList.length === 0 && description.split(/\s+/).length < 4,
      clarificationsNeeded: acList.length === 0 && description.split(/\s+/).length < 4
        ? [`Requirement '${id}' needs explicit acceptance criteria.`]
        : [],
      sourceRef: 'json',
    };
  });
}

function isVagueRequirementText(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/\b(test|improve|fix|feature|app|page|workflow|check|verify|make|better|it|the|for|and)\b/g, ' ').trim();
  const meaningfulWords = cleaned.match(/[a-z0-9]{3,}/g) ?? [];
  return meaningfulWords.length < 2;
}

function normalizeExistingTestSignature(test: ExistingTestInput): Set<string> {
  const raw = `${test.title ?? ''} ${test.sourceText}`
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return new Set(raw.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
}

function matchesExistingCoverage(scenarioTitle: string, expectedOutcomes: string[], existingTests: ExistingTestInput[]): boolean {
  if (existingTests.length === 0) return false;
  const stopWords = new Set(['should', 'user', 'with', 'page', 'after', 'that', 'when', 'the', 'and', 'for']);
  const titleTokens = new Set(
    scenarioTitle
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t)),
  );
  const outcomeTokens = new Set(
    `${scenarioTitle} ${expectedOutcomes.join(' ')}`
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t)),
  );
  if (titleTokens.size === 0) return false;

  for (const existing of existingTests) {
    const existingTokens = normalizeExistingTestSignature(existing);
    let titleOverlap = 0;
    for (const token of titleTokens) {
      if (existingTokens.has(token)) titleOverlap += 1;
    }
    let overallOverlap = 0;
    for (const token of outcomeTokens) {
      if (existingTokens.has(token)) overallOverlap += 1;
    }
    if (titleOverlap / titleTokens.size >= 0.75 || overallOverlap / outcomeTokens.size >= 0.6) {
      return true;
    }
  }
  return false;
}

function inferCategoriesForRequirement(
  req: NormalizedRequirement,
  gitDiff?: GitDiffHintsInput,
  sourceHints?: SourceAnalysisHints,
): Array<{ category: WorkflowScenarioCategory; provenance: WorkflowProvenance; priority: PlannedWorkflowScenario['priority']; triggerEvidence: string }> {
  const fullText = `${req.title}\n${req.description}\n${req.acceptanceCriteria.join('\n')}`.toLowerCase();
  const diffText = (gitDiff?.validationHints ?? []).join(' ').toLowerCase();
  const sourceText = (sourceHints?.validationRules ?? []).join(' ').toLowerCase();

  const entries: Array<{ category: WorkflowScenarioCategory; provenance: WorkflowProvenance; priority: PlannedWorkflowScenario['priority']; triggerEvidence: string }> = [
    { category: 'happy-path', provenance: req.provenance, priority: req.risk === 'critical' ? 'P0' : 'P1', triggerEvidence: req.id },
  ];

  // Negative / Validation
  if (/\b(invalid|reject|empty|error|prevent|fail|required|disallowed|duplicate)\b/.test(fullText)) {
    entries.push({ category: 'validation', provenance: 'explicit-requirement', priority: 'P1', triggerEvidence: req.id });
  } else if (/\b(required|email|min|max)\b/.test(sourceText)) {
    entries.push({ category: 'validation', provenance: 'source-derived', priority: 'P1', triggerEvidence: 'source-validation' });
  } else if (/\b(required|email|min|max)\b/.test(diffText)) {
    entries.push({ category: 'validation', provenance: 'diff-derived', priority: 'P1', triggerEvidence: 'git-diff-validation' });
  }

  // Boundary: ONLY when explicit bounds exist
  if (/\b(min(?:imum)?|max(?:imum)?|length|limit|character|capacity|at least|at most|\d+\s*(?:chars|items))\b/.test(fullText)) {
    entries.push({ category: 'boundary', provenance: 'explicit-requirement', priority: 'P2', triggerEvidence: req.id });
  } else if (/\b(min|max)\(\d+\)/.test(sourceText)) {
    entries.push({ category: 'boundary', provenance: 'source-derived', priority: 'P2', triggerEvidence: 'source-schema-bounds' });
  } else if (/\b(min|max)\(\d+\)/.test(diffText)) {
    entries.push({ category: 'boundary', provenance: 'diff-derived', priority: 'P2', triggerEvidence: 'git-diff-bounds' });
  }

  // Persistence
  if (/\b(persist|reload|refresh|saved|localstorage|survive|database)\b/.test(fullText)) {
    entries.push({ category: 'persistence', provenance: 'explicit-requirement', priority: 'P1', triggerEvidence: req.id });
  } else if (sourceHints?.persistenceDetected) {
    entries.push({ category: 'persistence', provenance: 'source-derived', priority: 'P2', triggerEvidence: 'source-persistence' });
  }

  // Authentication / Authorization
  if (/\b(auth|login|logged in|unauthenticated|guest|permission|role|forbidden|unauthorized|admin)\b/.test(fullText)) {
    entries.push({ category: 'authentication', provenance: 'explicit-requirement', priority: 'P0', triggerEvidence: req.id });
  } else if (sourceHints?.authRequired) {
    entries.push({ category: 'authentication', provenance: 'source-derived', priority: 'P0', triggerEvidence: 'source-auth-guard' });
  }

  // State lifecycle transitions (toggle/delete/edit/update/filter)
  if (/\b(toggle|complete|delete|remove|edit|update|filter|clear)\b/.test(fullText)) {
    entries.push({ category: 'state-transition', provenance: 'explicit-requirement', priority: 'P1', triggerEvidence: req.id });
  }

  // API consistency
  if ((sourceHints?.apiEndpoints?.length ?? 0) > 0 || (gitDiff?.apiEndpoints?.length ?? 0) > 0 || /\b(api|endpoint|http|status|response)\b/.test(fullText)) {
    const prov: WorkflowProvenance = /\b(api|endpoint|http|status|response)\b/.test(fullText)
      ? 'explicit-requirement'
      : (gitDiff?.apiEndpoints?.length ?? 0) > 0 ? 'diff-derived' : 'source-derived';
    entries.push({ category: 'ui-api-consistency', provenance: prov, priority: 'P1', triggerEvidence: prov });
  }

  return entries;
}

function buildStepsForScenario(
  req: NormalizedRequirement,
  category: WorkflowScenarioCategory,
  baseUrl?: string,
): { steps: WorkflowStep[]; expectedOutcomes: string[]; preconditions: string[] } {
  const preconditions = [baseUrl ? `the application is accessible at ${baseUrl}` : 'the target feature page is accessible'];

  switch (category) {
    case 'validation':
    case 'negative':
    case 'required-fields':
      return {
        preconditions,
        steps: [
          { keyword: 'Given', text: preconditions[0]! },
          { keyword: 'When', text: `the user submits invalid or empty input for "${req.title}"`, actionHint: 'submit-invalid' },
          { keyword: 'Then', text: 'the application rejects invalid submission and preserves valid state' },
        ],
        expectedOutcomes: ['Validation feedback shown or invalid submission blocked without corrupting state'],
      };
    case 'boundary':
      return {
        preconditions,
        steps: [
          { keyword: 'Given', text: preconditions[0]! },
          { keyword: 'When', text: `the user tests declared boundary values for "${req.title}"`, actionHint: 'test-boundary' },
          { keyword: 'Then', text: 'inputs inside bounds succeed and inputs outside bounds are rejected per rule' },
        ],
        expectedOutcomes: ['Boundary enforcement matches declared rule'],
      };
    case 'persistence':
      return {
        preconditions,
        steps: [
          { keyword: 'Given', text: `the user has completed "${req.title}"` },
          { keyword: 'When', text: 'the browser page is reloaded', actionHint: 'reload' },
          { keyword: 'Then', text: 'the updated state remains visible after reload' },
        ],
        expectedOutcomes: ['State survives client reload and matches backend/storage state'],
      };
    case 'authentication':
    case 'authorization':
      return {
        preconditions: ['the user starts without required authentication or role'],
        steps: [
          { keyword: 'Given', text: 'the user is not authenticated with the required permission' },
          { keyword: 'When', text: `the user attempts to access "${req.title}"`, actionHint: 'check-auth' },
          { keyword: 'Then', text: 'access is denied or redirected to login cleanly' },
        ],
        expectedOutcomes: ['Unauthorized access blocked'],
      };
    case 'state-transition':
      return {
        preconditions,
        steps: [
          { keyword: 'Given', text: `initial state for "${req.title}" is established` },
          { keyword: 'When', text: `the user performs the state transition in "${req.title}"`, actionHint: 'transition' },
          { keyword: 'Then', text: 'the UI indicators and counters reflect the new state cleanly' },
        ],
        expectedOutcomes: ['UI state transition reflected accurately'],
      };
    case 'ui-api-consistency':
      return {
        preconditions,
        steps: [
          { keyword: 'Given', text: preconditions[0]! },
          { keyword: 'When', text: `the user triggers the operation in "${req.title}"`, actionHint: 'trigger-api' },
          { keyword: 'Then', text: 'the observed network API response agrees with the updated UI state' },
        ],
        expectedOutcomes: ['Network response status/payload agrees with UI state'],
      };
    default:
      return {
        preconditions,
        steps: [
          { keyword: 'Given', text: preconditions[0]! },
          { keyword: 'When', text: `the user executes the primary flow for "${req.title}"`, actionHint: 'happy-path' },
          { keyword: 'Then', text: req.acceptanceCriteria[0] ? req.acceptanceCriteria[0] : `expected outcome for "${req.title}" is observed in the UI` },
        ],
        expectedOutcomes: req.acceptanceCriteria.length > 0 ? req.acceptanceCriteria : [`Observable outcome for ${req.title}`],
      };
  }
}

export function buildWorkflowPlan(input: WorkflowPlanInput): GenerationWorkflowPlan {
  const now = input.now ?? new Date();
  const inputsUsed: GenerationWorkflowPlan['inputs'] = [];
  let featureName = input.featureName?.trim() || input.jiraIssue?.summary?.trim() || 'Feature Workflow';
  const normalizedRequirements: NormalizedRequirement[] = [];
  const unresolvedQuestions: string[] = [];

  if (input.featureText) {
    inputsUsed.push({ kind: 'feature', reference: 'inline-feature' });
  }

  if (input.markdown) {
    inputsUsed.push({ kind: 'markdown', reference: 'markdown-requirements' });
    const parsedMd = parseMarkdownRequirements(input.markdown, featureName);
    if (!input.featureName) featureName = parsedMd.featureName;
    normalizedRequirements.push(...parsedMd.requirements);
  }

  if (input.jsonRequirements !== undefined) {
    inputsUsed.push({ kind: 'json', reference: 'json-requirements' });
    normalizedRequirements.push(...parseJsonRequirements(input.jsonRequirements, featureName));
  }

  if (input.jiraIssue) {
    inputsUsed.push({ kind: 'jira', reference: input.jiraIssue.key ?? 'jira-issue' });
    const ac = input.jiraIssue.acceptanceCriteria ?? [];
    const desc = input.jiraIssue.description ?? input.jiraIssue.summary;
    const intent = extractBusinessIntent({ id: input.jiraIssue.key ?? 'JIRA-1', title: input.jiraIssue.summary, sourceText: `${desc}\n${ac.join('\n')}` });
    normalizedRequirements.push({
      id: input.jiraIssue.key ?? 'JIRA-1',
      title: input.jiraIssue.summary,
      description: desc,
      acceptanceCriteria: ac,
      provenance: 'explicit-requirement',
      risk: intent.risk,
      ambiguous: ac.length === 0 && isVagueRequirementText(desc),
      clarificationsNeeded: ac.length === 0 && isVagueRequirementText(desc)
        ? [`Jira issue '${input.jiraIssue.summary}' lacks clear acceptance criteria.`]
        : [],
      sourceRef: input.jiraIssue.key,
    });
  }

  if (input.requirements && input.requirements.length > 0) {
    inputsUsed.push({ kind: 'json', reference: 'structured-requirements' });
    for (const req of input.requirements) {
      const desc = req.description ?? req.title;
      const intent = extractBusinessIntent({ id: req.id, title: req.title, sourceText: desc });
      const vague = !req.description && isVagueRequirementText(req.title);
      normalizedRequirements.push({
        id: req.id,
        title: req.title,
        description: desc,
        acceptanceCriteria: req.description ? [req.description] : [],
        provenance: 'explicit-requirement',
        risk: intent.risk,
        ambiguous: vague,
        clarificationsNeeded: vague ? [`Requirement '${req.title}' is ambiguous; clarify expected behavior.`] : [],
      });
    }
  }

  const plainText = input.prompt ?? input.text;
  if (plainText && normalizedRequirements.length === 0) {
    inputsUsed.push({ kind: input.prompt ? 'prompt' : 'text', reference: 'inline-requirement' });
    if (!input.featureName) {
      featureName = plainText.split(/\r?\n/)[0]!.trim().slice(0, 64) || featureName;
    }
    const intent = extractBusinessIntent({ id: 'REQ-1', title: featureName, sourceText: plainText });
    const vague = isVagueRequirementText(plainText);
    normalizedRequirements.push({
      id: 'REQ-1',
      title: featureName,
      description: plainText.trim(),
      acceptanceCriteria: vague ? [] : [plainText.trim()],
      provenance: 'explicit-requirement',
      risk: intent.risk,
      ambiguous: vague,
      clarificationsNeeded: vague ? [`Prompt '${plainText.trim()}' lacks specific expected behavior.`] : [],
    });
  }

  if (input.gitDiff && ((input.gitDiff.changedFiles?.length ?? 0) > 0 || (input.gitDiff.changedRoutes?.length ?? 0) > 0)) {
    inputsUsed.push({ kind: 'git-diff', reference: `diff:${input.gitDiff.changedFiles?.length ?? 0}-files` });
  }
  if (input.sourceHints && ((input.sourceHints.routes?.length ?? 0) > 0 || (input.sourceHints.validationRules?.length ?? 0) > 0)) {
    inputsUsed.push({ kind: 'source', reference: `source:${input.sourceHints.routes?.length ?? 0}-routes` });
  }

  // Fallback if only gitDiff or featureText arrived
  if (normalizedRequirements.length === 0 && input.gitDiff?.changedFiles?.length) {
    normalizedRequirements.push({
      id: 'DIFF-1',
      title: `Changes in ${input.gitDiff.changedFiles.slice(0, 3).join(', ')}`,
      description: `Verify flows impacted by changed files: ${input.gitDiff.changedFiles.join(', ')}`,
      acceptanceCriteria: [],
      provenance: 'diff-derived',
      risk: 'medium',
      ambiguous: true,
      clarificationsNeeded: ['Derived only from git diff without business requirements; clarify expected UI behavior.'],
      sourceRef: 'git-diff',
    });
  }

  for (const r of normalizedRequirements) {
    unresolvedQuestions.push(...r.clarificationsNeeded);
  }

  const existingTests = input.existingTests ?? [];
  const scenarios: PlannedWorkflowScenario[] = [];
  const seenIds = new Set<string>();

  for (const req of normalizedRequirements) {
    if (req.ambiguous && req.acceptanceCriteria.length === 0 && !input.sourceHints?.routes?.length && !input.gitDiff?.changedRoutes?.length) {
      const id = `sc-${toSlug(req.id)}-clarify-${stableHash(req.title).slice(0, 6)}`;
      seenIds.add(id);
      scenarios.push({
        id,
        requirementRefs: [req.id],
        title: `Clarify workflow for ${req.title}`,
        category: 'happy-path',
        priority: 'P2',
        tags: [`@id:${id}`, `@req:${req.id}`, '@needs-clarification'],
        provenance: req.provenance,
        applicability: 'needs_clarification',
        preconditions: [],
        steps: [
          { keyword: 'Given', text: `requirement "${req.title}" is supplied without acceptance criteria` },
          { keyword: 'When', text: 'the application context is inspected' },
          { keyword: 'Then', text: 'expected outcomes require explicit user or application evidence clarification' },
        ],
        expectedOutcomes: [],
        evidenceRequirements: ['explicit-ac-or-live-exploration'],
        confidence: 0.2,
        assumptions: req.clarificationsNeeded,
      });
      continue;
    }

    const categories = inferCategoriesForRequirement(req, input.gitDiff, input.sourceHints);
    for (const cat of categories) {
      let id = `sc-${toSlug(req.id)}-${cat.category}`;
      if (seenIds.has(id)) {
        id = `${id}-${stableHash(`${req.id}:${cat.category}:${scenarios.length}`).slice(0, 4)}`;
      }
      seenIds.add(id);

      const built = buildStepsForScenario(req, cat.category, input.baseUrl);
      const scenarioTitle = `${req.title} (${cat.category})`;
      const alreadyCovered = matchesExistingCoverage(req.title, built.expectedOutcomes, existingTests);
      const applicability: PlannedWorkflowScenario['applicability'] = alreadyCovered ? 'covered' : 'applicable';

      const tags = [
        `@id:${id}`,
        `@req:${req.id}`,
        `@${cat.category}`,
        `@${cat.provenance}`,
        ...(alreadyCovered ? ['@covered'] : []),
      ];

      scenarios.push({
        id,
        requirementRefs: [req.id],
        title: scenarioTitle,
        category: cat.category,
        priority: cat.priority,
        tags,
        provenance: cat.provenance,
        applicability,
        preconditions: built.preconditions,
        steps: built.steps,
        expectedOutcomes: built.expectedOutcomes,
        evidenceRequirements: [`live-ui:${cat.category}`, ...(cat.category === 'ui-api-consistency' ? ['network-api'] : [])],
        confidence: cat.provenance === 'explicit-requirement' ? 0.9 : 0.75,
        assumptions: cat.provenance === 'assumption' ? [`Derived as ${cat.category} assumption from ${cat.triggerEvidence}`] : [],
      });
    }
  }

  const background = [
    input.baseUrl ? `the application is accessible at ${input.baseUrl}` : 'the target application is running',
  ];

  const basePlan = {
    planVersion: '1.0' as const,
    featureName,
    slug: toSlug(featureName),
    background,
    inputs: inputsUsed,
    requirements: normalizedRequirements,
    scenarios,
    unresolvedQuestions: [...new Set(unresolvedQuestions)],
    ...(input.gitDiff ? {
      diffSummary: {
        changedFiles: input.gitDiff.changedFiles ?? [],
        changedRoutes: input.gitDiff.changedRoutes ?? [],
        apiEndpoints: input.gitDiff.apiEndpoints ?? [],
        validationHints: input.gitDiff.validationHints ?? [],
      },
    } : {}),
  };

  const plan: GenerationWorkflowPlan = {
    ...basePlan,
    createdAt: now.toISOString(),
    planHash: computeWorkflowPlanHash(basePlan),
  };

  // If initial input already was a .feature file, merge its scenarios cleanly
  if (input.featureText) {
    const imported = importGherkinToWorkflowPlan(input.featureText, {
      ...plan,
      scenarios: [],
    });
    if (imported.success && imported.plan) {
      return imported.plan;
    }
  }

  return plan;
}

export function exportWorkflowToGherkin(plan: GenerationWorkflowPlan): string {
  const lines: string[] = [
    `# pie-plan-hash: ${plan.planHash}`,
    `Feature: ${plan.featureName}`,
    '',
  ];

  if (plan.background.length > 0) {
    lines.push('  Background:');
    for (const bg of plan.background) {
      lines.push(`    Given ${bg}`);
    }
    lines.push('');
  }

  for (const scenario of plan.scenarios) {
    if (scenario.tags.length > 0) {
      lines.push(`  ${scenario.tags.join(' ')}`);
    }
    lines.push(`  Scenario: ${scenario.title}`);
    for (const step of scenario.steps) {
      lines.push(`    ${step.keyword} ${step.text}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function categoryFromTags(tags: string[]): WorkflowScenarioCategory {
  const map: Record<string, WorkflowScenarioCategory> = {
    '@happy-path': 'happy-path',
    '@negative': 'negative',
    '@validation': 'validation',
    '@required-fields': 'required-fields',
    '@boundary': 'boundary',
    '@persistence': 'persistence',
    '@authentication': 'authentication',
    '@auth': 'authentication',
    '@authorization': 'authorization',
    '@state-transition': 'state-transition',
    '@error-handling': 'error-handling',
    '@recovery': 'recovery',
    '@ui-api-consistency': 'ui-api-consistency',
  };
  for (const tag of tags) {
    const mapped = map[tag.toLowerCase()];
    if (mapped) return mapped;
  }
  return 'happy-path';
}

export function isStaleWorkflowPlan(featureText: string, canonicalPlan: GenerationWorkflowPlan): boolean {
  const hashMatch = featureText.match(/^#\s*pie-plan-hash:\s*([a-f0-9]+)\s*$/m);
  if (hashMatch && hashMatch[1] !== canonicalPlan.planHash) {
    return true;
  }
  const imported = importGherkinToWorkflowPlan(featureText, canonicalPlan);
  return imported.edited || !imported.success;
}

export function importGherkinToWorkflowPlan(
  featureText: string,
  canonicalPlan: GenerationWorkflowPlan,
): GherkinImportResult {
  const errors: string[] = [];
  const rawLines = featureText.split(/\r?\n/);

  let parsedFeatureName = canonicalPlan.featureName;
  let seenFeatureHeader = false;
  let inBackground = false;
  const parsedBackground: string[] = [];
  let pendingTags: string[] = [];

  interface ParsedRawScenario {
    title: string;
    tags: string[];
    steps: WorkflowStep[];
  }
  const parsedScenarios: ParsedRawScenario[] = [];
  let currentScenario: ParsedRawScenario | null = null;

  for (let i = 0; i < rawLines.length; i += 1) {
    const trimmed = rawLines[i]!.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;

    if (/^Scenario Outline\s*:/i.test(trimmed) || /^Examples\s*:/i.test(trimmed)) {
      errors.push(`UNSUPPORTED_GHERKIN_SYNTAX at line ${i + 1}: Scenario Outline / Examples tables are not supported for round-trip import.`);
      continue;
    }

    if (trimmed.startsWith('|')) {
      errors.push(`UNSUPPORTED_GHERKIN_SYNTAX at line ${i + 1}: Gherkin DataTables are not supported.`);
      continue;
    }

    const featureMatch = trimmed.match(/^Feature\s*:\s*(.+)$/i);
    if (featureMatch) {
      seenFeatureHeader = true;
      parsedFeatureName = featureMatch[1]!.trim();
      inBackground = false;
      currentScenario = null;
      continue;
    }

    if (/^Background\s*:/i.test(trimmed)) {
      inBackground = true;
      currentScenario = null;
      pendingTags = [];
      continue;
    }

    if (trimmed.startsWith('@')) {
      const tags = trimmed.split(/\s+/).filter((t) => t.startsWith('@'));
      pendingTags.push(...tags);
      continue;
    }

    const scenarioMatch = trimmed.match(/^Scenario\s*:\s*(.+)$/i);
    if (scenarioMatch) {
      inBackground = false;
      if (currentScenario) parsedScenarios.push(currentScenario);
      currentScenario = {
        title: scenarioMatch[1]!.trim(),
        tags: pendingTags,
        steps: [],
      };
      pendingTags = [];
      continue;
    }

    const stepMatch = trimmed.match(/^(Given|When|Then|And|But)\s+(.+)$/i);
    if (stepMatch) {
      const kwRaw = stepMatch[1]!;
      const kw = (kwRaw[0]!.toUpperCase() + kwRaw.slice(1).toLowerCase()) as WorkflowStep['keyword'];
      const text = stepMatch[2]!.trim();
      if (inBackground) {
        parsedBackground.push(text);
      } else if (currentScenario) {
        currentScenario.steps.push({ keyword: kw, text });
      } else {
        errors.push(`SYNTAX_ERROR at line ${i + 1}: Step found outside Scenario or Background: '${trimmed}'`);
      }
      continue;
    }

    errors.push(`UNSUPPORTED_GHERKIN_SYNTAX at line ${i + 1}: Unrecognized Gherkin line '${trimmed}'`);
  }

  if (currentScenario) parsedScenarios.push(currentScenario);

  if (!seenFeatureHeader) {
    errors.push('INVALID_GHERKIN_FEATURE: Missing Feature: header.');
  }

  if (errors.length > 0) {
    return {
      success: false,
      edited: false,
      addedScenarioIds: [],
      removedScenarioIds: [],
      modifiedScenarioIds: [],
      errors,
    };
  }

  const existingById = new Map(canonicalPlan.scenarios.map((s) => [s.id, s]));
  const seenScenarioIds = new Set<string>();
  const rebuiltScenarios: PlannedWorkflowScenario[] = [];
  const addedScenarioIds: string[] = [];
  const modifiedScenarioIds: string[] = [];

  for (const rawSc of parsedScenarios) {
    if (rawSc.steps.length === 0) {
      errors.push(`INVALID_GHERKIN_SCENARIO: Scenario '${rawSc.title}' has zero steps.`);
      continue;
    }
    const hasWhenOrThen = rawSc.steps.some((s) => s.keyword === 'When' || s.keyword === 'Then');
    if (!hasWhenOrThen) {
      errors.push(`INVALID_GHERKIN_SCENARIO: Scenario '${rawSc.title}' must contain at least one When or Then step.`);
      continue;
    }

    const idTag = rawSc.tags.find((t) => t.startsWith('@id:'));
    let scenarioId = idTag ? idTag.slice('@id:'.length).trim() : `sc-edited-${toSlug(rawSc.title)}-${stableHash(rawSc.title).slice(0, 6)}`;
    if (!scenarioId) {
      errors.push(`INVALID_SCENARIO_ID: Empty @id: tag on scenario '${rawSc.title}'.`);
      continue;
    }
    if (seenScenarioIds.has(scenarioId)) {
      errors.push(`DUPLICATE_SCENARIO_ID: Scenario ID '${scenarioId}' appears multiple times.`);
      continue;
    }
    seenScenarioIds.add(scenarioId);

    const reqTags = rawSc.tags.filter((t) => t.startsWith('@req:')).map((t) => t.slice('@req:'.length).trim()).filter(Boolean);
    const prior = existingById.get(scenarioId);
    const category = categoryFromTags(rawSc.tags);
    const expectedOutcomes = rawSc.steps.filter((s) => s.keyword === 'Then').map((s) => s.text);
    const preconditions = rawSc.steps.filter((s) => s.keyword === 'Given').map((s) => s.text);

    const tags = rawSc.tags.includes(`@id:${scenarioId}`) ? rawSc.tags : [`@id:${scenarioId}`, ...rawSc.tags];
    const requirementRefs = reqTags.length > 0
      ? reqTags
      : prior?.requirementRefs ?? [canonicalPlan.requirements[0]?.id ?? 'REQ-1'];

    const mergedSteps = rawSc.steps.map((step, idx) => {
      const priorStep = prior?.steps[idx];
      if (priorStep && priorStep.keyword === step.keyword && priorStep.text === step.text && priorStep.actionHint) {
        return { ...step, actionHint: priorStep.actionHint, ...(priorStep.targetHint ? { targetHint: priorStep.targetHint } : {}), ...(priorStep.valueHint ? { valueHint: priorStep.valueHint } : {}) };
      }
      return step;
    });

    const stepsChanged = !prior || JSON.stringify(prior.steps.map((s) => `${s.keyword}:${s.text}`)) !== JSON.stringify(mergedSteps.map((s) => `${s.keyword}:${s.text}`));

    const scenarioObj: PlannedWorkflowScenario = {
      id: scenarioId,
      requirementRefs,
      title: rawSc.title,
      category: prior && !rawSc.tags.some((t) => t === `@${category}`) ? prior.category : category,
      priority: prior?.priority ?? 'P1',
      tags,
      provenance: prior?.provenance ?? 'explicit-requirement',
      applicability: rawSc.tags.includes('@covered')
        ? 'covered'
        : rawSc.tags.includes('@needs-clarification')
          ? 'needs_clarification'
          : 'applicable',
      preconditions,
      steps: mergedSteps,
      expectedOutcomes: stepsChanged ? (expectedOutcomes.length > 0 ? expectedOutcomes : prior?.expectedOutcomes ?? []) : (prior?.expectedOutcomes ?? expectedOutcomes),
      evidenceRequirements: prior?.evidenceRequirements ?? [`live-ui:${category}`],
      confidence: prior?.confidence ?? 0.9,
      assumptions: prior?.assumptions ?? [],
    };

    if (!prior) {
      addedScenarioIds.push(scenarioId);
    } else if (
      prior.title !== scenarioObj.title ||
      stepsChanged ||
      JSON.stringify(prior.tags) !== JSON.stringify(scenarioObj.tags)
    ) {
      modifiedScenarioIds.push(scenarioId);
    }

    rebuiltScenarios.push(scenarioObj);
  }

  if (errors.length > 0) {
    return {
      success: false,
      edited: false,
      addedScenarioIds: [],
      removedScenarioIds: [],
      modifiedScenarioIds: [],
      errors,
    };
  }

  const removedScenarioIds = canonicalPlan.scenarios
    .filter((s) => !seenScenarioIds.has(s.id))
    .map((s) => s.id);

  const background = parsedBackground.length > 0 ? parsedBackground : canonicalPlan.background;
  const baseUpdated = {
    planVersion: canonicalPlan.planVersion,
    featureName: parsedFeatureName,
    slug: toSlug(parsedFeatureName),
    background,
    inputs: canonicalPlan.inputs,
    requirements: canonicalPlan.requirements,
    scenarios: rebuiltScenarios,
    unresolvedQuestions: canonicalPlan.unresolvedQuestions,
    ...(canonicalPlan.diffSummary ? { diffSummary: canonicalPlan.diffSummary } : {}),
  };

  const edited =
    parsedFeatureName !== canonicalPlan.featureName ||
    JSON.stringify(background) !== JSON.stringify(canonicalPlan.background) ||
    addedScenarioIds.length > 0 ||
    removedScenarioIds.length > 0 ||
    modifiedScenarioIds.length > 0;

  return {
    success: true,
    plan: {
      ...baseUpdated,
      createdAt: canonicalPlan.createdAt,
      planHash: computeWorkflowPlanHash(baseUpdated),
    },
    edited,
    addedScenarioIds,
    removedScenarioIds,
    modifiedScenarioIds,
    errors: [],
  };
}
