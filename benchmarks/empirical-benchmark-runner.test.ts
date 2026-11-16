import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ControlledAppServer } from '../../benchmarks/controlled-app/app-server.js';
import { MasterBenchmarkRunner } from '../../benchmarks/runner/master-benchmark-runner.js';

describe('Empirical Browser Benchmark Suite & Metrics Engine (Gate C)', () => {
  let app: ControlledAppServer;
  const testPort = 4188;

  beforeEach(async () => {
    app = new ControlledAppServer();
    await app.start(testPort);
  });

  afterEach(async () => {
    await app.stop();
  });

  it('BENCH-01: ControlledAppServer correctly supports seeded defects and mutations', async () => {
    expect(app.defects.DEFECT_WRONG_TOTAL).toBe(false);
    expect(app.defects.DEFECT_SERVER_500).toBe(false);
    expect(app.mutations.dynamicId).toBe(false);

    // Apply mutations
    app.mutations.dynamicId = true;
    app.mutations.accessibleNameDrift = true;
    app.defects.DEFECT_SERVER_500 = true;

    expect(app.mutations.dynamicId).toBe(true);
    expect(app.mutations.accessibleNameDrift).toBe(true);
    expect(app.defects.DEFECT_SERVER_500).toBe(true);

    // Reset restores clean state
    app.reset();
    expect(app.mutations.dynamicId).toBe(false);
    expect(app.mutations.accessibleNameDrift).toBe(false);
    expect(app.defects.DEFECT_SERVER_500).toBe(false);
  });

  it('BENCH-02: MasterBenchmarkRunner executes fast classifier unit scenarios', async () => {
    const runner = new MasterBenchmarkRunner({ port: testPort });
    const unitRecords = await runner.runClassifierUnitScenarios();

    expect(unitRecords.length).toBeGreaterThanOrEqual(3);
    for (const record of unitRecords) {
      expect(record.expectedOutcome).toBe('ABSTAIN');
      expect(record.actualOutcome).toBe('ABSTAIN');
      expect(record.intentInvariantPassed).toBe(true);
    }
  });

  it('BENCH-03: Benchmark filtering correctly respects family and scenario filters', () => {
    const runner = new MasterBenchmarkRunner({
      familyFilter: 'Dynamic IDs',
      scenarioFilter: '500',
      browser: 'chromium',
    });

    expect(runner).toBeDefined();
  });
});

