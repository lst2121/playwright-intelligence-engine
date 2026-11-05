import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  dts: false,
  external: [
    '@playwright/test',
    'playwright',
    'playwright-core',
    'ts-morph',
    'adm-zip',
    'zod',
  ],
});

