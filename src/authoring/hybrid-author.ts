import { Author, AuthorInput, CandidateChange } from './author.js';
import { planArchitecture, toSlug } from '../generator/architecture-generator.js';
import { NamePlanner } from './naming/name-planner.js';
import { NamePlanSchema, type NamePlan } from './naming/name-plan.js';
import { NamingLinter } from './naming/naming-linter.js';

export class HybridAuthor implements Author {
  public readonly kind = 'hybrid';

  public async propose(input: AuthorInput): Promise<CandidateChange> {
    const steps = input.steps ?? [{ action: 'navigate' }, { action: 'assert-visible', role: 'heading', name: input.featureName }];

    let namePlan: NamePlan;
    // Attempt LLM symbol proposal if API key is present (opt-in under Vitest)
    const liveAllowed = !process.env.VITEST || process.env.PIE_LIVE_LLM_TESTS === '1';
    const apiKey = liveAllowed ? (process.env.PIE_LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY) : undefined;
    const endpoint = process.env.PIE_LLM_ENDPOINT ?? (apiKey ? 'https://api.deepseek.com/chat/completions' : undefined);
    const model = process.env.PIE_LLM_MODEL ?? (apiKey ? 'deepseek-chat' : undefined);

    let rationale = 'Hybrid-authored: deterministic template rendering guided by semantic symbol plan.';

    if (apiKey && endpoint && model) {
      try {
        const exemplarText = (input.exemplars ?? [])
          .slice(0, 2)
          .map((e) => `// Exemplar Page Object: ${e.className} (${e.filePath})\n${e.content.slice(0, 500)}`)
          .join('\n\n');

        const prompt = [
          'You are an expert Playwright automation engineer. Given the feature and test steps, produce a concise JSON Symbol Table (NamePlan) naming the Page Object class and each element.',
          'Conventions to follow:',
          '- Name Page Object classes after the application page (e.g. LoginPage, CartPage, CheckoutPage), NOT after the test scenario title.',
          '- Property names must be camelCase with role suffix (e.g. emailInput, signInButton, searchInput, orderStatus).',
          '- Method names must be camelCase with verb (e.g. fillEmail, signIn, submitOrder, openPricing). NEVER use raw numbers or index-derived names like actionButton1 or fill2.',
          exemplarText ? `\nSibling Exemplars from target repository:\n${exemplarText}\n` : '',
          `Feature: "${input.featureName}"`,
          `Steps: ${JSON.stringify(steps, null, 2)}`,
          '\nRespond ONLY with valid JSON conforming to this schema:',
          '{',
          '  "planVersion": "1",',
          '  "pageClassName": "LoginPage",',
          '  "pageVariable": "loginPage",',
          '  "symbols": [',
          '    { "ref": "step-1", "role": "textbox", "accessibleName": "Email", "property": "emailInput", "method": "fillEmail", "verb": "fill", "confidence": 0.95, "source": "llm", "assumptions": [] }',
          '  ],',
          '  "assumptions": []',
          '}',
        ].join('\n');

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 1000,
          }),
        });

        if (response.ok) {
          const json = await response.json() as any;
          const rawContent = json.choices?.[0]?.message?.content ?? '';
          const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          const validated = NamePlanSchema.safeParse(parsed);
          if (validated.success && validated.data.symbols.length === steps.length) {
            const lintReport = NamingLinter.lint(validated.data);
            if (lintReport.passed) {
              namePlan = validated.data;
              rationale = 'Hybrid-authored: LLM semantic naming guided by sibling exemplars, compiled through deterministic template.';
            } else {
              namePlan = NamePlanner.planNames(input.featureName, steps, { source: 'heuristic' });
            }
          } else {
            namePlan = NamePlanner.planNames(input.featureName, steps, { source: 'heuristic' });
          }
        } else {
          namePlan = NamePlanner.planNames(input.featureName, steps, { source: 'heuristic' });
        }
      } catch {
        namePlan = NamePlanner.planNames(input.featureName, steps, { source: 'heuristic' });
      }
    } else {
      namePlan = NamePlanner.planNames(input.featureName, steps, { source: 'heuristic' });
    }

    const plan = planArchitecture({
      featureName: input.featureName,
      mode: input.mode,
      baseUrl: input.baseUrl,
      requirements: input.requirements,
      steps,
      profile: input.profile,
      existingFiles: input.existingFiles,
      namePlan,
    });

    return {
      files: plan.files.map((f) => ({
        relativePath: f.relativePath,
        content: f.content,
        purpose: f.purpose,
        action: f.action,
      })),
      symbols: namePlan,
      rationale,
      authorKind: 'hybrid',
      featureName: input.featureName,
      slug: toSlug(input.featureName),
      mode: input.mode,
    };
  }
}

