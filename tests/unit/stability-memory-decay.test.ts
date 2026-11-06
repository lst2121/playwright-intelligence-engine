import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { effectiveReliabilityScore, StabilityLedger, SelectorHistoryRecord } from '../../src/memory/stability-ledger.js';

describe('stability memory decay and feedback', () => {
  it('decays old positive evidence toward the neutral prior without changing false-repair penalties', () => {
    const record: SelectorHistoryRecord = {
      selector: 'button.submit', successes: 10, failures: 0, semanticVerifications: 10,
      repairsAccepted: 1, falseRepairIncidents: 0, lastSuccess: 0, lastFailure: 0,
      failureCategories: [], reliabilityScore: 1, historicalExecutionReliability: 1,
    };
    expect(effectiveReliabilityScore(record, 0, 1_000)).toBe(1);
    expect(effectiveReliabilityScore({ ...record, lastSuccess: 10 }, 20, 10)).toBe(0.874);
    expect(effectiveReliabilityScore({ ...record, falseRepairIncidents: 1, lastSuccess: 10 }, 20, 10)).toBe(0.1);
  });

  it('records accepted and rejected operator feedback through the ledger', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-feedback-'));
    const ledger = new StabilityLedger(root);
    await ledger.init();
    await ledger.recordRepairFeedback('selector.accepted', 'accepted');
    await ledger.recordRepairFeedback('selector.rejected', 'rejected');
    expect(ledger.getSnapshot().selectors['selector.accepted']?.repairsAccepted).toBe(1);
    expect(ledger.getSnapshot().selectors['selector.rejected']?.falseRepairIncidents).toBe(1);
    await fs.rm(root, { recursive: true, force: true });
  });
});
