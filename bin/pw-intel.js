#!/usr/bin/env node
import { runCli } from '../dist/index.js';

runCli(process.argv).catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});

