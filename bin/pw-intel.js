#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Automatically load local .env if present
try {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '.env')
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
      break;
    }
  }
} catch {}

import { runCli } from '../dist/index.js';

runCli(process.argv).catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});

