import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIE_ROOT = path.resolve(__dirname, '..');
const TESTBED_ROOT = 'D:\\Work\\pie-real-repository-testbed\\repositories';
const HEROKU_ROOT = 'D:\\Work\\heroku-playwright-project';

function findConfigs(dir) {
  const configs = [];
  try {
    for (const item of fs.readdirSync(dir)) {
      if (item === 'node_modules' || item === '.git' || item === 'test-results') continue;
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        configs.push(...findConfigs(full));
      } else if (/^playwright.*\.config\.[jt]sx?$/i.test(item)) {
        configs.push(full);
      }
    }
  } catch {}
  return configs;
}

function parseTestDir(configPath, repoDir) {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const match = content.match(/testDir:\s*['"`]([^'"`]+)['"`]/);
    if (match && match[1]) {
      const configDir = path.dirname(configPath);
      return path.resolve(configDir, match[1]);
    }
  } catch {}
  // Default fallbacks
  const defaults = [
    path.join(repoDir, 'tests', 'e2e'),
    path.join(repoDir, 'tests'),
    path.join(repoDir, 'e2e'),
  ];
  for (const d of defaults) {
    if (fs.existsSync(d)) return d;
  }
  return repoDir;
}

function findSpecs(testDir) {
  const specs = [];
  if (!fs.existsSync(testDir)) return specs;
  function walk(d) {
    try {
      for (const item of fs.readdirSync(d)) {
        if (item === 'node_modules' || item === '.git' || item === 'test-results' || item === '.pw-intelligence' || item === '.pie') continue;
        const full = path.join(d, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(?:spec|test)\.[jt]sx?$/i.test(item) && !item.toLowerCase().includes('setup')) {
          specs.push(full);
        }
      }
    } catch {}
  }
  walk(testDir);
  return specs;
}

function scan() {
  const manifest = {
    generatedAt: new Date().toISOString(),
    repositories: [],
    totals: {
      totalSpecsPresent: 0,
      runnableTodaySpecs: 0,
      infraBoundSpecs: 0,
    },
  };

  const candidateDirs = [];
  if (fs.existsSync(TESTBED_ROOT)) {
    for (const item of fs.readdirSync(TESTBED_ROOT)) {
      const full = path.join(TESTBED_ROOT, item);
      if (fs.statSync(full).isDirectory() && item !== 'node_modules' && item !== '.git') {
        candidateDirs.push(full);
      }
    }
  }
  if (fs.existsSync(HEROKU_ROOT)) {
    candidateDirs.push(HEROKU_ROOT);
  }

  for (const repoDir of candidateDirs) {
    const repoName = path.basename(repoDir);
    const configs = findConfigs(repoDir);
    const primaryConfig = configs[0];
    const testDir = primaryConfig ? parseTestDir(primaryConfig, repoDir) : repoDir;
    const allSpecs = findSpecs(testDir);

    let runnability = 'BLOCKED_INFRA';
    let runCmdTemplate = 'npx playwright test {specFile}';
    let env = {};

    // Determine runnability based on verified live services
    if (repoName === 'saucedemo-playwright-typescript') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile} --project=logged-in-chromium-desktop';
    } else if (repoName === 'playwright-e2e-tests') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile} --project=chromium';
    } else if (repoName === 'epic-stack') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile} --project=chromium';
      env = { PORT: '3100' };
    } else if (repoName === 'twenty') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile} --project=chromium';
      env = { BASE_URL: 'http://localhost:3010' };
    } else if (repoName === 'heroku-playwright-project') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile} --project=chromium';
    } else if (repoName === 'playwright-examples') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile}';
    } else if (repoName === 'next-realworld-playwright') {
      runnability = 'RUNNABLE';
      runCmdTemplate = 'npx playwright test {specFile}';
    }

    manifest.repositories.push({
      repoName,
      repoDir,
      configPath: primaryConfig || null,
      testDir,
      runnability,
      runCmdTemplate,
      env,
      specCount: allSpecs.length,
      specs: allSpecs.map((s) => path.relative(repoDir, s).replace(/\\/g, '/')),
    });

    manifest.totals.totalSpecsPresent += allSpecs.length;
    if (runnability === 'RUNNABLE') {
      manifest.totals.runnableTodaySpecs += allSpecs.length;
    } else {
      manifest.totals.infraBoundSpecs += allSpecs.length;
    }
  }

  const outDir = path.join(PIE_ROOT, '.pie');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'fleet-manifest.json');
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Fleet Manifest generated at: ${outFile}`);
  console.log(`Total Specs Discovered  : ${manifest.totals.totalSpecsPresent}`);
  console.log(`Runnable Today Specs    : ${manifest.totals.runnableTodaySpecs}`);
  console.log(`Infra-Bound Specs       : ${manifest.totals.infraBoundSpecs}`);
  console.log(`Repositories Audited    : ${manifest.repositories.length}`);
}

scan();
