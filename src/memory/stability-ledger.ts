import fs from 'node:fs/promises';
import path from 'node:path';

export interface SelectorHistoryRecord {
  selector: string;
  successes: number;
  failures: number;
  semanticVerifications: number;
  repairsAccepted: number;
  falseRepairIncidents: number;
  lastSuccess?: number | undefined;
  lastFailure?: number | undefined;
  failureCategories: string[];
  reliabilityScore: number;
  historicalExecutionReliability: number;
}

export interface StabilityLedgerData {
  version: number;
  updatedAt: number;
  scope: {
    projectRoot: string;
    repositoryName: string;
  };
  selectors: Record<string, SelectorHistoryRecord>;
}

export class StabilityLedger {
  private readonly ledgerPath: string;
  private data: StabilityLedgerData | null = null;

  constructor(baseDir = '.') {
    this.ledgerPath = path.resolve(baseDir, '.pw-intelligence', 'stability-ledger.json');
  }

  public async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    try {
      const raw = await fs.readFile(this.ledgerPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StabilityLedgerData>;
      this.data = {
        version: parsed.version ?? 3,
        updatedAt: parsed.updatedAt ?? Date.now(),
        scope: parsed.scope ?? {
          projectRoot: path.resolve(path.dirname(this.ledgerPath), '..'),
          repositoryName: path.basename(path.resolve(path.dirname(this.ledgerPath), '..')),
        },
        selectors: parsed.selectors ?? {},
      };
      if (!parsed.scope || parsed.version !== 3) await this.save();
    } catch {
      this.data = {
        version: 3,
        updatedAt: Date.now(),
        scope: {
          projectRoot: path.resolve(path.dirname(this.ledgerPath), '..'),
          repositoryName: path.basename(path.resolve(path.dirname(this.ledgerPath), '..')),
        },
        selectors: {},
      };
      await this.save();
    }
  }

  public getScore(selector: string): number {
    if (!this.data) return 0.8; // Default baseline score
    const record = this.data.selectors[selector];
    if (!record) return 0.8;
    return record.reliabilityScore;
  }

  public async recordSuccess(selector: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data!.selectors[selector] ?? {
      selector,
      successes: 0,
      failures: 0,
      semanticVerifications: 1,
      repairsAccepted: 0,
      falseRepairIncidents: 0,
      failureCategories: [],
      reliabilityScore: 0.8,
      historicalExecutionReliability: 0.8,
    };

    existing.successes += 1;
    existing.lastSuccess = Date.now();
    existing.reliabilityScore = this.computeScore(existing);
    existing.historicalExecutionReliability = existing.reliabilityScore;
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  public async recordFailure(selector: string, category: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data!.selectors[selector] ?? {
      selector,
      successes: 0,
      failures: 0,
      semanticVerifications: 0,
      repairsAccepted: 0,
      falseRepairIncidents: 0,
      failureCategories: [],
      reliabilityScore: 0.8,
      historicalExecutionReliability: 0.8,
    };

    existing.failures += 1;
    existing.lastFailure = Date.now();
    if (!existing.failureCategories.includes(category)) {
      existing.failureCategories.push(category);
    }
    existing.reliabilityScore = this.computeScore(existing);
    existing.historicalExecutionReliability = existing.reliabilityScore;
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  public async recordSemanticVerification(selector: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data!.selectors[selector] ?? this.createRecord(selector);
    existing.semanticVerifications += 1;
    // A semantic verification is produced only after the isolated execution
    // and intent gates pass. Count it as one successful observation so future
    // candidate ranking can learn from verified repairs, while keeping the
    // separate repairsAccepted field as operator-approval metadata.
    existing.successes += 1;
    existing.lastSuccess = Date.now();
    existing.reliabilityScore = this.computeScore(existing);
    existing.historicalExecutionReliability = existing.reliabilityScore;
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  public async recordRepairAccepted(selector: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data!.selectors[selector] ?? this.createRecord(selector);
    existing.repairsAccepted += 1;
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  public getSnapshot(): StabilityLedgerData {
    if (!this.data) {
      return {
        version: 3,
        updatedAt: 0,
        scope: {
          projectRoot: path.resolve(path.dirname(this.ledgerPath), '..'),
          repositoryName: path.basename(path.resolve(path.dirname(this.ledgerPath), '..')),
        },
        selectors: {},
      };
    }
    return JSON.parse(JSON.stringify(this.data)) as StabilityLedgerData;
  }

  public async recordFalseRepairIncident(selector: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data!.selectors[selector] ?? {
      selector,
      successes: 0,
      failures: 1,
      semanticVerifications: 0,
      repairsAccepted: 0,
      falseRepairIncidents: 0,
      failureCategories: ['FALSE_REPAIR'],
      reliabilityScore: 0.2,
      historicalExecutionReliability: 0.2,
    };

    existing.falseRepairIncidents += 1;
    existing.reliabilityScore = this.computeScore(existing);
    existing.historicalExecutionReliability = existing.reliabilityScore;
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  private computeScore(record: { successes: number; failures: number; falseRepairIncidents: number }): number {
    // If any false repair incident occurred, severely penalize (fail-safe against confirmation bias)
    if (record.falseRepairIncidents > 0) {
      return 0.1;
    }
    const total = record.successes + record.failures * 2; // Penalize failures with double weight
    if (total === 0) return 0.8;
    const score = record.successes / total;
    return parseFloat(score.toFixed(3));
  }

  private createRecord(selector: string): SelectorHistoryRecord {
    return {
      selector,
      successes: 0,
      failures: 0,
      semanticVerifications: 0,
      repairsAccepted: 0,
      falseRepairIncidents: 0,
      failureCategories: [],
      reliabilityScore: 0.8,
      historicalExecutionReliability: 0.8,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.data) await this.init();
  }

  private async save(): Promise<void> {
    if (!this.data) return;
    this.data.updatedAt = Date.now();
    await fs.writeFile(this.ledgerPath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

