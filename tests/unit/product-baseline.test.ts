import { describe, expect, it } from 'vitest';
import { ENGINE_MILESTONE, PACKAGE_VERSION, PROOF_VERSION } from '../../src/core/version.js';

describe('Product identity baseline', () => {
  it('exposes the package version used by CLI and MCP consumers', () => {
    expect(PACKAGE_VERSION).toMatch(/^2\.\d+\.\d+/);
  });

  it('binds execution proofs to the current engineering milestone', () => {
    expect(PROOF_VERSION).toBe(ENGINE_MILESTONE);
    expect(ENGINE_MILESTONE).toMatch(/^2\.\d+\.\d+/);
  });
});
