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
      this.data = JSON.parse(raw);
    } catch {
      this.data = {
        version: 2,
        updatedAt: Date.now(),
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

  private async ensureLoaded(): Promise<void> {
    if (!this.data) await this.init();
  }

  private async save(): Promise<void> {
    if (!this.data) return;
    this.data.updatedAt = Date.now();
    await fs.writeFile(this.ledgerPath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

