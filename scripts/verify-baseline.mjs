import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm' : 'npm';

const requiredPaths = [
  'package.json',
  'src/index.ts',
  'bin/pw-intel.js',
  'tests',
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    console.error(`[baseline] Missing required path: ${relativePath}`);
    process.exit(1);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'playwright-intelligence-engine') {
  console.error(`[baseline] Unexpected package name: ${packageJson.name}`);
  process.exit(1);
}

const checks = [
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['test', '--', '--reporter=dot']],
  ['build', ['run', 'build']],
];

for (const [label, args] of checks) {
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${npmCommand} ${args.join(' ')}`]
    : args;
  const command = process.platform === 'win32' ? 'cmd.exe' : npmCommand;
  console.log(`\n[baseline] Running ${label}: ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    console.error(`[baseline] ${label} could not start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[baseline] ${label} failed with exit code ${result.status ?? 'unknown'}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[baseline] PASS: typecheck, tests, and build completed successfully.');

