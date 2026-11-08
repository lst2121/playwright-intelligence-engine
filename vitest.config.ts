import { defineConfig } from 'vitest/config';

/**
 * Reproducibility note (PIE v3.2):
 * The default `forks` pool fails to initialise the suite collector in restricted
 * environments (and on some clean installs), producing
 *   TypeError: Cannot read properties of undefined (reading 'config')
 * on the first `describe()` call of every test file, with "Tests: no tests".
 * `vmForks` initialises the collector correctly and is now pinned so that
 * `npm ci && npm test` behaves identically on a clean clone.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'vmForks',
    include: ['tests/**/*.test.ts'],
  },
});

