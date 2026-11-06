import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { runTraceProposalWorkflow } from '../../src/intelligence/trace-proposal-workflow.js';
import { ProposalProvider } from '../../src/intelligence/model-provider.js';

class FakeProvider implements ProposalProvider {
  public calls = 0;
  public async propose() {
    this.calls += 1;
    return {
      isValid: true,
      errors: [],
      proposal: {
        proposalVersion: '1' as const,
        decision: 'PROPOSE' as const,
        failureKind: 'LOCATOR_DRIFT',
        confidence: 0.86,
        reasoningSummary: 'The unique button remains actionable and can use its accessible name.',
        operations: [{ kind: 'replace_locator' as const, target: '#old-submit', locator: "getByRole('button', { name: 'Submit' })" }],
        requiredVerification: ['isolated target test'],
        evidenceReferences: ['trace.zip'],
      },
    };
  }
}

async function makeTrace(root: string): Promise<string> {
  const tracePath = path.join(root, 'trace.zip');
  const zip = new AdmZip();
  zip.addFile('0-trace.trace', Buffer.from([
    JSON.stringify({ type: 'version', version: 10 }),
    JSON.stringify({ type: 'before', callId: 'click@1', apiName: 'page.click', params: { selector: '#old-submit' } }),
    JSON.stringify({ type: 'frame-snapshot', snapshot: { callId: 'click@1', node: ['html', {}, ['body', {}, ['button', { role: 'button' }, 'Submit']]] } }),
    JSON.stringify({ type: 'after', callId: 'click@1', error: { message: 'Timeout waiting for locator("#old-submit")' } }),
  ].join('\n')));
  zip.writeZip(tracePath);
  return tracePath;
}

describe('trace-backed bounded model proposal workflow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs deterministic classification before invoking the configured provider', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-trace-proposal-'));
    const provider = new FakeProvider();
    const result = await runTraceProposalWorkflow({ tracePath: await makeTrace(root), workspaceRoot: root, provider });
    expect(result.agent.state).toBe('PROPOSAL_RECEIVED');
    expect(result.agent.modelInvoked).toBe(true);
    expect(provider.calls).toBe(1);
    expect(result.bundle.diagnostic?.failedAction.selector).toBe('#old-submit');
    expect(result.bundle.sourceContext[0]?.filePath).toBe('.pie/project-intelligence.json');
    expect(result.bundle.sourceContext[0]?.content).toContain('preferredLocator');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports model-not-configured without making a network call', async () => {
    vi.stubEnv('PIE_LLM_ENDPOINT', '');
    vi.stubEnv('PIE_LLM_MODEL', '');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-trace-proposal-no-model-'));
    const result = await runTraceProposalWorkflow({ tracePath: await makeTrace(root), workspaceRoot: root });
    expect(result.agent.state).toBe('MODEL_NOT_CONFIGURED');
    expect(result.agent.modelInvoked).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });
});
