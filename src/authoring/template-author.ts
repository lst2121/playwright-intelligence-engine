import { Author, AuthorInput, CandidateChange } from './author.js';
import { planArchitecture, toSlug } from '../generator/architecture-generator.js';
import { NamePlanner } from './naming/name-planner.js';

export class TemplateAuthor implements Author {
  public readonly kind = 'template';

  public async propose(input: AuthorInput): Promise<CandidateChange> {
    const steps = input.steps ?? [{ action: 'navigate' }, { action: 'assert-visible', role: 'heading', name: input.featureName }];
    const symbols = NamePlanner.planNames(input.featureName, steps, { source: 'heuristic' });

    const plan = planArchitecture({
      featureName: input.featureName,
      mode: input.mode,
      baseUrl: input.baseUrl,
      requirements: input.requirements,
      steps,
      profile: input.profile,
      existingFiles: input.existingFiles,
      namePlan: symbols,
    });

    return {
      files: plan.files.map((f) => ({
        relativePath: f.relativePath,
        content: f.content,
        purpose: f.purpose,
        action: f.action,
      })),
      symbols,
      rationale: 'Template-authored scaffold with deterministic heuristic symbol mapping.',
      authorKind: 'template',
      featureName: input.featureName,
      slug: toSlug(input.featureName),
      mode: input.mode,
    };
  }
}

