import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProjectConfig, loadProjectConfig } from '../../src/config/project-config.js';

describe('PIE project configuration', () => {
  it('creates a safe project-local configuration from repository conventions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-init-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { 'test:e2e': 'playwright test' },
    }), 'utf8');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}', 'utf8');

    const result = await initProjectConfig(root, { now: new Date('2026-01-02T03:04:05.000Z') });
    expect(result.created).toBe(true);
    expect(result.config.test.packageManager).toBe('npm');
    expect(result.config.test.command).toBe('test:e2e');
    expect(result.config.diagnostics.failClosed).toBe(true);
    expect(result.config.diagnostics.allowDirectWorkspaceMutation).toBe(false);

    const loaded = await loadProjectConfig(root);
    expect(loaded.projectRoot).toBe(root);
    expect(loaded.memory.repositoryProfilePath).toBe('.pie/repository-profile.json');
  });

  it('does not overwrite an existing configuration without force', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-init-existing-'));
    const first = await initProjectConfig(root, { now: new Date('2026-01-02T03:04:05.000Z') });
    const second = await initProjectConfig(root, { now: new Date('2027-01-02T03:04:05.000Z') });
    expect(second.created).toBe(false);
    expect(second.config.createdAt).toBe(first.config.createdAt);
  });
});
