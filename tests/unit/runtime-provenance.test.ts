import { describe, expect, it } from 'vitest';
import { getRuntimeProvenance } from '../../src/core/version.js';

describe('runtime provenance', () => {
  it('reports the current repository revision for evaluation auditability', () => {
    const provenance = getRuntimeProvenance(process.cwd());
    expect(provenance.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof provenance.workspaceDirty).toBe('boolean');
  });
});
