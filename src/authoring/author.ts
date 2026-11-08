import type { ArchitectureMode } from '../generator/architecture-generator.js';
import type { GeneratedStep } from '../generator/test-generator.js';
import type { RepositoryConventionProfile, PageObjectExemplar } from '../intelligence/repository-profile.js';
import type { NamePlan } from './naming/name-plan.js';

export type AuthorKind = 'template' | 'hybrid' | 'llm';

export interface CandidateFile {
  relativePath: string;
  content: string;
  purpose?: string | undefined;
  action?: 'CREATE' | 'SKIP_EXISTING' | undefined;
}

export interface CandidateChange {
  files: CandidateFile[];
  symbols: NamePlan;
  rationale: string;
  authorKind: AuthorKind;
  featureName: string;
  slug: string;
  mode: ArchitectureMode;
}

export interface AuthorInput {
  featureName: string;
  mode: ArchitectureMode;
  baseUrl?: string | undefined;
  requirements?: string | undefined;
  steps?: GeneratedStep[] | undefined;
  profile?: RepositoryConventionProfile | undefined;
  existingFiles?: string[] | undefined;
  exemplars?: PageObjectExemplar[] | undefined;
}

export interface Author {
  readonly kind: AuthorKind;
  propose(input: AuthorInput): Promise<CandidateChange>;
}

