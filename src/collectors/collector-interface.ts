import { UnifiedEvidenceRecord, EvidenceSource } from '../evidence/evidence-model.js';

export interface EvidenceCollector<TInput = any> {
  readonly name: string;
  readonly source: EvidenceSource;
  collect(input: TInput): Promise<UnifiedEvidenceRecord[]>;
}
