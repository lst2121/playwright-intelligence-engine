import { describe, expect, it } from 'vitest';
import { ENGINE_MILESTONE, PACKAGE_VERSION, PROOF_VERSION } from '../../src/core/version.js';

describe('Product identity baseline', () => {
  it('exposes the package version used by CLI and MCP consumers', () => {
    expect(PACKAGE_VERSION).toBe('1.0.0');
  });

  it('binds execution proofs to the current engineering milestone', () => {
    expect(PROOF_VERSION).toBe(ENGINE_MILESTONE);
    expect(ENGINE_MILESTONE).toBe('1.0.0');
  });
});
