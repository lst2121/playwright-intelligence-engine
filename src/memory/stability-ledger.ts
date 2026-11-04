import fs from 'node:fs/promises';
import path from 'node:path';

export interface SelectorHistoryRecord {
  selector: string;
  successes: number;
  failures: number;
  lastSuccess?: number;
  lastFailure?: number;
  failureCategories: string[];
  reliabilityScore: number;
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
        version: 1,
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
      failureCategories: [],
      reliabilityScore: 0.8,
    };

    existing.successes += 1;
    existing.lastSuccess = Date.now();
    existing.reliabilityScore = this.computeScore(existing.successes, existing.failures);
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  public async recordFailure(selector: string, category: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.data!.selectors[selector] ?? {
      selector,
      successes: 0,
      failures: 0,
      failureCategories: [],
      reliabilityScore: 0.8,
    };

    existing.failures += 1;
    existing.lastFailure = Date.now();
    if (!existing.failureCategories.includes(category)) {
      existing.failureCategories.push(category);
    }
    existing.reliabilityScore = this.computeScore(existing.successes, existing.failures);
    this.data!.selectors[selector] = existing;
    await this.save();
  }

  private computeScore(successes: number, failures: number): number {
    const total = successes + failures * 2; // Penalize failures with double weight
    if (total === 0) return 0.8;
    const score = successes / total;
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

