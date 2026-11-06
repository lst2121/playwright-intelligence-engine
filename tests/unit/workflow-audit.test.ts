import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AuditLog } from '../../src/governance/audit-log.js';
import { planArchitecture } from '../../src/generator/architecture-generator.js';
import { buildCiEvidenceReport } from '../../src/integrations/playwright-report-adapter.js';
import { recordArchitectureWorkflow, recordCiWorkflow } from '../../src/governance/workflow-audit.js';

describe('Workflow audit integration', () => {
  it('records architecture and CI decisions in a verifiable hash chain', async () => {
    const root = path.resolve('tests/fixtures/tmp-workflow-audit');
    await fs.rm(root, { recursive: true, force: true });
    const plan = planArchitecture({ featureName: 'Login', mode: 'greenfield' });
    await recordArchitectureWorkflow(root, plan);
    await recordCiWorkflow(root, buildCiEvidenceReport({ suites: [] }, { runId: 'audit-run' }));

    const verification = await new AuditLog(root).verify();
    expect(verification).toMatchObject({ valid: true, eventCount: 2 });
    const raw = await fs.readFile(path.join(root, '.pw-intelligence', 'audit.log'), 'utf8');
    expect(raw).not.toContain('import {');
    await fs.rm(root, { recursive: true, force: true });
  });
});
