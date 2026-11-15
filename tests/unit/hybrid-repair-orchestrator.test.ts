import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { runHybridRepair, HybridRepairProgressEvent } from '../../src/repair/hybrid-repair-orchestrator.js';

describe('Hybrid Repair Orchestrator (hybrid-repair-orchestrator)', () => {
  it('should return empty result when no failing traces are discovered', async () => {
    const events: HybridRepairProgressEvent[] = [];
    const result = await runHybridRepair({
      workspaceRoot: path.resolve(process.cwd(), 'tests'),
      tracePaths: [],
      mode: 'hybrid',
      onProgress: (ev) => events.push(ev),
    });

    expect(result.mode).toBe('hybrid');
    expect(result.totalTraces).toBe(0);
    expect(result.repairedCount).toBe(0);
    expect(result.items).toHaveLength(0);
    expect(result.aggregateTelemetry.totalTokens).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('should support deterministic mode and emit progress events', async () => {
    const events: HybridRepairProgressEvent[] = [];
    const result = await runHybridRepair({
      workspaceRoot: process.cwd(),
      tracePaths: ['non-existent-trace.zip'],
      mode: 'deterministic',
      onProgress: (ev) => events.push(ev),
    });

    expect(result.mode).toBe('deterministic');
    expect(result.totalTraces).toBe(1);
    expect(result.items[0]?.tier).toBe('tier1_deterministic');
    expect(result.items[0]?.status).toBe('FAILED');
    expect(events.length).toBeGreaterThan(0);
  });

  it('should support pure LLM mode without failing fast', async () => {
    const result = await runHybridRepair({
      workspaceRoot: process.cwd(),
      tracePaths: ['non-existent-trace.zip'],
      mode: 'llm',
    });

    expect(result.mode).toBe('llm');
    expect(result.totalTraces).toBe(1);
    expect(result.items[0]?.tier).toBe('tier2_llm');
    expect(result.items[0]?.status).toBe('FAILED');
  });
});
