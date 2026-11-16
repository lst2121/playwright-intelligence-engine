import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIE_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PIE_ROOT, '.pie', 'fleet-manifest.json');
const REPORT_PATH = path.join(PIE_ROOT, '.pie', 'reports', 'fleet-extended-report.json');
const PIE_CLI = path.resolve(PIE_ROOT, 'bin', 'pw-intel.js');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('Fleet manifest not found. Run fleet-manifest-builder.mjs first.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Initialize or load existing report for resumability
let report = {
  startedAt: new Date().toISOString(),
  lastUpdatedAt: new Date().toISOString(),
  totals: {
    totalSpecsAudited: 0,
    executed: 0,
    preRepairFailed: 0,
    repairedAndGreen: 0,
    abstainedGate0: 0,
    failedOrTimedOut: 0,
    tokens: 0,
    costUsd: 0,
  },
  results: [],
  defectTickets: [],
  generationResults: [],
};

if (fs.existsSync(REPORT_PATH)) {
  try {
    const existing = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    if (existing && Array.isArray(existing.results)) {
      report = existing;
      console.log(`Loaded existing report with ${report.results.length} completed entries. Resuming...`);
    }
  } catch {}
}

function saveReport() {
  report.lastUpdatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

function cleanRepo(repoRoot) {
  try {
    execSync('git checkout -- .', { cwd: repoRoot, stdio: 'ignore' });
    execSync('git clean -fd', { cwd: repoRoot, stdio: 'ignore' });
    const resultsDir = path.join(repoRoot, 'test-results');
    if (fs.existsSync(resultsDir)) {
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  } catch {}
}

function findTrace(repoRoot, specFile) {
  const resultsDir = path.join(repoRoot, 'test-results');
  if (!fs.existsSync(resultsDir)) return undefined;
  const traces = [];
  const walk = (d) => {
    try {
      for (const item of fs.readdirSync(d)) {
        const p = path.join(d, item);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (item.endsWith('.zip')) traces.push(p);
      }
    } catch {}
  };
  walk(resultsDir);

  const nonSetup = traces.filter((t) => !t.toLowerCase().includes('setup.ts'));
  const pool = nonSetup.length > 0 ? nonSetup : traces;
  if (specFile) {
    const base = path.basename(specFile, path.extname(specFile)).replace(/\.(?:spec|test)$/, '').toLowerCase();
    const matching = pool.filter((t) => t.toLowerCase().includes(base));
    if (matching.length > 0) return matching[0];
  }
  return pool[0];
}

// Find an interactive statement in spec content to mutate
function injectAstMutation(specContent, category) {
  if (category === 'NEGATIVE_CONTROL_500') {
    const testMatch = specContent.match(/(test\s*\([^,]+,\s*async\s*\([^)]*\)\s*=>\s*\{)/);
    if (testMatch) {
      const injection = `${testMatch[1]}\n    await (page ?? (adminPage?.page)).route('**/api/**', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error": "Internal Server Error"}' }));\n`;
      return { mutatedContent: specContent.replace(testMatch[1], injection), mutatedSnippet: 'Injected route 500 on **/api/**' };
    }
  }

  const actionRegex = /(await\s+[a-zA-Z0-9_$.]+(?:\([^)]*\))?(?:\.[a-zA-Z0-9_$.]+(?:\([^)]*\))?)*?\.(?:click|fill|check|selectOption|press|login|addItemToCart|goToCart|finishOrder|sendMessage)\([^)]*\))/;
  const match = specContent.match(actionRegex);
  if (match && match[1]) {
    const fullAction = match[1];
    let mutatedAction = fullAction;
    if (category === 'LOCATOR_DRIFT') {
      if (fullAction.includes('getByRole')) {
        mutatedAction = fullAction.replace(/getByRole\((['"`])([^'"`]+)\1/, "getByRole($1$2_obsolete_drift_v9$1");
      } else if (fullAction.includes('getByTestId')) {
        mutatedAction = fullAction.replace(/getByTestId\((['"`])([^'"`]+)\1/, "getByTestId($1$2_obsolete_drift_v9$1");
      } else if (fullAction.includes('locator(')) {
        mutatedAction = fullAction.replace(/locator\((['"`])([^'"`]+)\1/, "locator($1#obsolete_drift_id_v9$1");
      } else {
        mutatedAction = `await page.locator('#drifted-obsolete-action-btn').click()`;
      }
    } else if (category === 'STRICT_MODE_COLLISION') {
      mutatedAction = `await page.locator('button').click()`;
    } else {
      mutatedAction = `await page.locator('#drifted-obsolete-action-btn').click()`;
    }

    if (mutatedAction === fullAction) {
      mutatedAction = `await page.locator('#drifted-obsolete-action-btn').click()`;
    }

    return {
      mutatedContent: specContent.replace(fullAction, mutatedAction),
      mutatedSnippet: `${fullAction.slice(0, 50)} -> ${mutatedAction.slice(0, 50)}`,
    };
  }

  return null;
}

async function runFleet() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║        PLAYWRIGHT INTELLIGENCE ENGINE (PIE) EXTENDED FLEET RUNNER    ║');
  console.log('║               Maximum Real-World Spec Benchmark & QA Run             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const runnableRepos = manifest.repositories.filter((r) => r.runnability === 'RUNNABLE' && r.specCount > 0);
  console.log(`Auditing ${runnableRepos.length} live runnable repositories...`);

  const categories = ['LOCATOR_DRIFT', 'LOCATOR_DRIFT', 'STRICT_MODE_COLLISION', 'LOCATOR_DRIFT', 'NEGATIVE_CONTROL_500'];

  for (const repo of runnableRepos) {
    console.log(`\n══════════════════════════════════════════════════════════════════════`);
    console.log(`REPOSITORY: ${repo.repoName} (${repo.specCount} specs)`);
    console.log(`══════════════════════════════════════════════════════════════════════`);

    for (let sIdx = 0; sIdx < repo.specs.length; sIdx++) {
      const relSpec = repo.specs[sIdx];
      const specId = `${repo.repoName}::${relSpec}`;

      // Check if already executed in previous run
      if (report.results.some((r) => r.id === specId)) {
        console.log(`› [SKIP] Already completed: ${specId}`);
        continue;
      }

      const fullSpecPath = path.join(repo.repoDir, relSpec);
      if (!fs.existsSync(fullSpecPath)) {
        console.log(`› [WARN] File not found on disk: ${fullSpecPath}, skipping.`);
        continue;
      }

      const category = categories[sIdx % categories.length];
      const isNegativeControl = category === 'NEGATIVE_CONTROL_500';

      console.log(`\n----------------------------------------------------------------------`);
      console.log(`[Spec ${sIdx + 1}/${repo.specs.length}] ${specId}`);
      console.log(`Category: ${category}`);

      cleanRepo(repo.repoDir);

      const originalCode = fs.readFileSync(fullSpecPath, 'utf8');
      const mutationResult = injectAstMutation(originalCode, category);

      if (!mutationResult) {
        console.log(`› Inapplicable: No interactive action found to mutate.`);
        cleanRepo(repo.repoDir);
        continue;
      }

      fs.writeFileSync(fullSpecPath, mutationResult.mutatedContent, 'utf8');
      console.log(`✔ Injected mutation: ${mutationResult.mutatedSnippet}`);

      // Run Playwright (expecting failure)
      const repoEnv = { ...process.env, ...repo.env, PW_TEST_HTML_REPORT_OPEN: 'never' };
      const runCmd = repo.runCmdTemplate.replace('{specFile}', relSpec) + ' --trace=on --reporter=line';
      let preRepairFailed = false;
      const startMs = Date.now();

      try {
        execSync(runCmd, { cwd: repo.repoDir, env: repoEnv, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
        console.log(`✖ Unexpected pass without defect trigger (ineffective mutation).`);
      } catch (err) {
        preRepairFailed = true;
        console.log(`✔ Defect confirmed: Playwright failed as expected.`);
      }

      if (!preRepairFailed) {
        cleanRepo(repo.repoDir);
        continue;
      }

      // Discover trace
      const traceZip = findTrace(repo.repoDir, relSpec);
      if (!traceZip) {
        console.log(`✖ No trace produced by Playwright, skipping repair.`);
        cleanRepo(repo.repoDir);
        continue;
      }

      console.log(`✔ Trace discovered: ${path.basename(path.dirname(traceZip))}/trace.zip`);

      let pieAction = 'FAILED';
      let repairTier = 'N/A';
      let tokens = 0;
      let costUsd = 0;
      let postRepairPassed = false;

      if (isNegativeControl) {
        console.log(`› Testing Gate 0 Negative Control (Expected: ABSTAIN)...`);
        let repairOut = '';
        try {
          const repairCmd = `node "${PIE_CLI}" repair "${traceZip}" --workspace "${repo.repoDir}"`;
          repairOut = execSync(repairCmd, { cwd: PIE_ROOT, env: repoEnv, encoding: 'utf8', timeout: 90000 });
        } catch (e) {
          repairOut = (e.stdout || '') + '\n' + (e.stderr || '');
        }

        if (repairOut.includes('ABSTAINED') || repairOut.includes('[ABSTAINED]')) {
          pieAction = 'ABSTAINED';
          repairTier = 'N/A (Gate 0 Guard)';
          console.log(`✅ Gate 0 Passed: Engine strictly ABSTAINED on backend error!`);
          report.totals.abstainedGate0++;

          // Generate ticket
          try {
            const ticketFile = `.pie/tickets/defect-${repo.repoName}-${path.basename(relSpec, path.extname(relSpec))}.md`;
            const fullTicketPath = path.resolve(PIE_ROOT, ticketFile);
            fs.mkdirSync(path.dirname(fullTicketPath), { recursive: true });
            execSync(`node "${PIE_CLI}" report-defect "${traceZip}" --workspace "${repo.repoDir}" --out "${fullTicketPath}"`, {
              cwd: PIE_ROOT,
              env: repoEnv,
              encoding: 'utf8',
              timeout: 60000,
            });
            console.log(`✔ Defect ticket generated at: ${ticketFile}`);
            report.defectTickets.push(ticketFile);
          } catch {}
        }
      } else {
        console.log(`› Running PIE Autonomous Healing (pie repair --apply)...`);
        let repairOut = '';
        try {
          const repairCmd = `node "${PIE_CLI}" repair "${traceZip}" --apply --verbose --workspace "${repo.repoDir}"`;
          repairOut = execSync(repairCmd, { cwd: PIE_ROOT, env: repoEnv, encoding: 'utf8', timeout: 120000 });
        } catch (e) {
          repairOut = (e.stdout || '') + '\n' + (e.stderr || '');
        }

        if (repairOut.includes('REPAIRED') || repairOut.includes('Verified green') || repairOut.includes('[REPAIRED]')) {
          pieAction = 'REPAIRED_AND_VERIFIED';
          repairTier = repairOut.includes('Fast-Path AST') ? 'Fast-Path AST' : 'Semantic LLM';
          console.log(`✔ PIE Healed [${repairTier}]`);

          const tMatch = repairOut.match(/Total Tokens\s+:\s+([\d,]+)/);
          if (tMatch) tokens = parseInt(tMatch[1].replace(/,/g, ''), 10);
          const cMatch = repairOut.match(/Total Cost\s+:\s+\$([\d.]+)/);
          if (cMatch) costUsd = parseFloat(cMatch[1]);

          // Post-repair verify
          try {
            const verifyCmd = repo.runCmdTemplate.replace('{specFile}', relSpec) + ' --reporter=line';
            execSync(verifyCmd, { cwd: repo.repoDir, env: repoEnv, stdio: 'pipe', timeout: 90000 });
            postRepairPassed = true;
            console.log(`✅ Post-repair verification: PASSED GREEN!`);
            report.totals.repairedAndGreen++;
          } catch {
            console.log(`✖ Post-repair re-run failed.`);
          }
        } else {
          console.log(`✖ Repair outcome: ${repairOut.slice(0, 150)}`);
          report.totals.failedOrTimedOut++;
        }
      }

      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);

      report.totals.executed++;
      report.totals.preRepairFailed++;
      report.totals.tokens += tokens;
      report.totals.costUsd += costUsd;

      report.results.push({
        id: specId,
        repo: repo.repoName,
        spec: relSpec,
        category,
        preRepairFailed,
        pieAction,
        repairTier,
        postRepairPassed: isNegativeControl ? 'N/A (Abstained)' : postRepairPassed,
        tokens,
        costUsd,
        durationSec,
      });

      saveReport();
      cleanRepo(repo.repoDir);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('                 EXTENDED FLEET RUN COMPLETE                          ');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Total Specs Executed       : ${report.totals.executed}`);
  console.log(`Pre-Repair Failure Rate    : 100% (${report.totals.preRepairFailed}/${report.totals.executed})`);
  console.log(`Repaired & Verified Green  : ${report.totals.repairedAndGreen}`);
  console.log(`Gate 0 Abstentions         : ${report.totals.abstainedGate0}`);
  console.log(`Total Tokens               : ${report.totals.tokens}`);
  console.log(`Total Spend                : $${report.totals.costUsd.toFixed(6)} USD`);
  console.log(`Report JSON written to     : ${REPORT_PATH}`);
}

runFleet().catch(console.error);
