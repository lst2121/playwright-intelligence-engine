import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('first-party PIE skill pack', () => {
  it('ships the core agent workflows with safety instructions', async () => {
    const root = path.resolve('skills');
    const files = [
      'pie-quality-engineer/SKILL.md',
      'pie-failure-investigation/SKILL.md',
      'pie-repair-review/SKILL.md',
      'pie-trace-to-repair/SKILL.md',
      'pie-release-readiness/SKILL.md',
    ];
    for (const file of files) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      expect(content).toContain('---');
      expect(content).toContain('PIE');
    }
    const quality = await fs.readFile(path.join(root, files[0]!), 'utf8');
    expect(quality).toContain('Never:');
    expect(quality).toContain('human approval');
    expect(quality).toContain('ABSTAIN');
  });
});
