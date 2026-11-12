import type { ArchitectureMode } from '../generator/architecture-generator.js';
import type { GeneratedStep } from '../generator/test-generator.js';
import type { RepositoryConventionProfile, PageObjectExemplar } from '../intelligence/repository-profile.js';
import type { NamePlan } from './naming/name-plan.js';
import type { FullGenerationProposal } from './generation-contract.js';

export type AuthorKind = 'template' | 'hybrid' | 'llm';

export interface CandidateFile {
  relativePath: string;
  content: string;
  purpose?: string | undefined;
  action?: 'CREATE' | 'MODIFY' | 'SKIP_EXISTING' | undefined;
  rationale?: string | undefined;
  evidenceReferences?: string[] | undefined;
  scenarioIds?: string[] | undefined;
}

export interface CandidateChange {
  files: CandidateFile[];
  symbols: NamePlan;
  rationale: string;
  authorKind: AuthorKind;
  featureName: string;
  slug: string;
  mode: ArchitectureMode;
  status?: 'GENERATE' | 'NEEDS_INPUT' | 'ABSTAIN' | undefined;
  fullCodeAuthoring?: boolean | undefined;
  usedFallback?: boolean | undefined;
  proposal?: FullGenerationProposal | undefined;
  assumptions?: string[] | undefined;
  requiredClarifications?: string[] | undefined;
  validationErrors?: string[] | undefined;
}

export interface FullCodeGenerationInput {
  featureName: string;
  mode: ArchitectureMode;
  baseUrl?: string | undefined;
  requirements?: string | undefined;
  steps?: GeneratedStep[] | undefined;
  profile?: RepositoryConventionProfile | undefined;
  existingFiles?: string[] | undefined;
  exemplars?: PageObjectExemplar[] | undefined;
  contextPacket?: unknown;
  workflowPlan?: unknown;
  explorationBundle?: unknown;
  scenarios?: unknown;
  existingFileSnapshots?: Array<{ path: string; content: string; hash?: string | undefined }> | undefined;
  allowedEvidenceIds?: string[] | undefined;
  feedback?: string[] | undefined;
}

export interface FullCodeGenerationProvider {
  generate(input: FullCodeGenerationInput): Promise<unknown>;
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
  contextPacket?: unknown;
  workflowPlan?: unknown;
  explorationBundle?: unknown;
  scenarios?: unknown;
  existingFileSnapshots?: Array<{ path: string; content: string; hash?: string | undefined }> | undefined;
  allowedEvidenceIds?: string[] | undefined;
  requireEvidenceReferences?: boolean | undefined;
  fullCodeProvider?: FullCodeGenerationProvider | undefined;
  feedback?: string[] | undefined;
}

export interface Author {
  readonly kind: AuthorKind;
  propose(input: AuthorInput): Promise<CandidateChange>;
}
