import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TESTBED_ROOT = 'D:\\Work\\pie-real-repository-testbed\\repositories';
const HEROKU_ROOT = 'D:\\Work\\heroku-playwright-project';

const FLEET_CONFIG = [
  {
    name: 'saucedemo-playwright-typescript',
    root: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    runCmd: 'npx playwright test --project=logged-in-chromium-desktop --trace=on --reporter=list',
    verifyCmd: 'npx playwright test --project=logged-in-chromium-desktop --reporter=list',
    env: {},
  },
  {
    name: 'heroku-playwright-project',
    root: HEROKU_ROOT,
    runCmd: 'npx playwright test tests/dropdown.test.ts --trace=on --reporter=list',
    verifyCmd: 'npx playwright test tests/dropdown.test.ts --reporter=list',
    env: {},
  },
  {
    name: 'playwright-e2e-tests',
    root: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    runCmd: 'npx playwright test tests/admin-panel/login.spec.ts --project=chromium --trace=on --reporter=list',
    verifyCmd: 'npx playwright test tests/admin-panel/login.spec.ts --project=chromium --reporter=list',
    env: {},
  },
  {
    name: 'epic-stack',
    root: path.join(TESTBED_ROOT, 'epic-stack'),
    runCmd: 'npx playwright test tests/e2e/search.test.ts --timeout=30000 --trace=on --reporter=list',
    verifyCmd: 'npx playwright test tests/e2e/search.test.ts --timeout=30000 --reporter=list',
    env: { PORT: '3100' },
  },
];

console.log('══════════════════════════════════════════════════════════════════════');
console.log('         PLAYWRIGHT INTELLIGENCE ENGINE: FLEET-WIDE RUNNER            ');
console.log('══════════════════════════════════════════════════════════════════════\n');

async function executeFleetRun() {
  const fleetResults = [];

  for (const repo of FLEET_CONFIG) {
    console.log(`\n──────────────────────────────────────────────────────────────────────`);
    console.log(`[Fleet Runner] Processing repository: ${repo.name}`);
    console.log(`  Directory: ${repo.root}`);

    if (!fs.existsSync(repo.root)) {
      console.warn(`  [WARN] Path not found, skipping.`);
      continue;
    }

    const repoEnv = { ...process.env, ...repo.env };

    // Inject mutations for this repository
    const injectorPath = path.resolve(PIE_ROOT, '.agents', 'skills', 'pie-mutation-injector', 'scripts', 'inject-fleet-mutations.mjs');
    try {
      execSync(`node "${injectorPath}" inject`, { cwd: PIE_ROOT, stdio: 'inherit' });
    } catch {}

    // 1. Initial execution to capture baseline / mutated trace
    console.log(`  › Executing test suite under mutation...`);
    let testOutput = '';
    let testSuccess = false;
    const startTime = Date.now();
    try {
      testOutput = execSync(repo.runCmd, { cwd: repo.root, env: repoEnv, encoding: 'utf8' });
      testSuccess = true;
      console.log(`    Suite passed without mutations.`);
    } catch (err) {
      testOutput = err.stdout || err.message;
      console.log(`    Suite failed as expected under mutation.`);
    }

    // 2. Discover traces
    const resultsDir = path.join(repo.root, 'test-results');
    const traces = [];
    if (fs.existsSync(resultsDir)) {
      const walk = (dir) => {
        for (const item of fs.readdirSync(dir)) {
          const p = path.join(dir, item);
          if (fs.statSync(p).isDirectory()) walk(p);
          else if (item.endsWith('.zip')) traces.push(p);
        }
      };
      walk(resultsDir);
    }
    console.log(`  › Discovered ${traces.length} trace archive(s).`);

    // 3. Run PIE repair on traces
    let repairedCount = 0;
    let abstainedCount = 0;
    let tokensSpent = 0;
    let costSpent = 0;

    if (traces.length > 0) {
      console.log(`  › Executing PIE Autonomous Healing (pie repair --apply --verbose)...`);
      try {
        const repairCmd = `pie repair "${traces[0]}" --apply --verbose`;
        const repairOut = execSync(repairCmd, { cwd: repo.root, env: repoEnv, encoding: 'utf8' });
        console.log(`    Repair completed.`);

        if (repairOut.includes('Verified green') || repairOut.includes('[REPAIRED]')) {
          repairedCount++;
        }
        if (repairOut.includes('ABSTAIN') || repairOut.includes('negative controls')) {
          abstainedCount++;
        }

        const tokenMatch = repairOut.match(/Total Tokens\s+:\s+([\d,]+)/);
        if (tokenMatch) tokensSpent += parseInt(tokenMatch[1].replace(/,/g, ''), 10);

        const costMatch = repairOut.match(/Total Cost\s+:\s+\$([\d.]+)/);
        if (costMatch) costSpent += parseFloat(costMatch[1]);
      } catch (err) {
        console.log(`    Repair error or abstention:`, (err.stdout || err.message).slice(0, 150));
      }
    }

    // 4. Re-verify healed test
    console.log(`  › Re-running test suite to verify healing...`);
    let finalSuccess = false;
    try {
      execSync(repo.verifyCmd, { cwd: repo.root, env: repoEnv, stdio: 'ignore' });
      finalSuccess = true;
      console.log(`    ✔ Post-repair test suite PASSED GREEN!`);
    } catch {
      console.log(`    ✖ Post-repair test suite did not pass cleanly.`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    fleetResults.push({
      repo: repo.name,
      tracesDiscovered: traces.length,
      repaired: repairedCount,
      abstained: abstainedCount,
      finalGreen: finalSuccess,
      tokensSpent,
      costSpent,
      durationSec: duration,
    });

    // Clean repo
    try {
      execSync('git checkout -- .', { cwd: repo.root, stdio: 'ignore' });
      execSync('git clean -fd', { cwd: repo.root, stdio: 'ignore' });
    } catch {}
  }

  // Summary Table
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('              FLEET-WIDE VERIFICATION METRICS SUMMARY                 ');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.table(fleetResults);
  console.log(`Total Repositories Verified : ${fleetResults.length}`);
  console.log(`Total Traces Ingested       : ${fleetResults.reduce((a, b) => a + b.tracesDiscovered, 0)}`);
  console.log(`Total Verified Repairs      : ${fleetResults.reduce((a, b) => a + b.repaired, 0)}`);
  console.log(`Total Spend                 : $${fleetResults.reduce((a, b) => a + b.costSpent, 0).toFixed(6)} USD`);
  console.log('══════════════════════════════════════════════════════════════════════\n');
}

executeFleetRun().catch(console.error);
