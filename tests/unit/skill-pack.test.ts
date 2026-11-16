import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('first-party PIE skill pack', () => {
  it('ships the core agent workflows with safety instructions', async () => {
    const root = path.resolve('skills');
    const files = [
      'pie-setup/SKILL.md',
      'pie-self-heal/SKILL.md',
      'pie-stabilize/SKILL.md',
    ];
    for (const file of files) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      expect(content).toContain('---');
      expect(content).toContain('PIE');
    }
    const selfHeal = await fs.readFile(path.join(root, 'pie-self-heal/SKILL.md'), 'utf8');
    expect(selfHeal).toContain('Gate 0');
    expect(selfHeal).toContain('DO NOT REWRITE TEST CODE');
    expect(selfHeal).toContain('worktree');
  });
});
