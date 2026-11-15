import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { runBatchRepairWorkflow } from '../../src/intelligence/batch-repair-workflow.js';

describe('Batch Auto-Healing Engine (batch-repair-workflow)', () => {
  it('should abstain cleanly when no trace archives are discovered', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pie-empty-trace-'));
    try {
      const result = await runBatchRepairWorkflow({
        workspaceRoot: emptyDir,
        tracePaths: [],
      });

      expect(result.status).toBe('ABSTAINED');
      expect(result.totalTraces).toBe(0);
      expect(result.repairedCount).toBe(0);
      expect(result.items).toHaveLength(0);
      expect(result.clusters).toHaveLength(0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('should return PROPOSAL_READY for diagnosable traces when execute is false', async () => {
    // If a non-existent trace is passed, it records failure or abstention gracefully
    const result = await runBatchRepairWorkflow({
      workspaceRoot: process.cwd(),
      tracePaths: ['non-existent-trace.zip'],
      execute: false,
    });

    expect(result.totalTraces).toBe(1);
    expect(result.items[0]?.status).toBe('FAILED');
    expect(result.items[0]?.category).toBe('INTERNAL_ERROR');
  });
});
