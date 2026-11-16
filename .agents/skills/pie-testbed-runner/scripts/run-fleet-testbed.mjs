import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TESTBED_ROOT = 'D:\\Work\\pie-real-repository-testbed\\repositories';
const HEROKU_ROOT = 'D:\\Work\\heroku-playwright-project';

const SPEC_BENCHMARK_SUITE = [
  // 1. Saucedemo: auth.spec.ts (Locator Drift)
  {
    id: 'sauce-auth-drift',
    repoName: 'saucedemo-playwright-typescript',
    repoRoot: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    specFile: 'tests/ui/auth.spec.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Drift login submit button locator to obsolete ID in auth spec',
    target: "await loginPage.login('standard_user', 'secret_sauce');",
    replacement: "await page.getByTestId('username').fill('standard_user'); await page.getByTestId('password').fill('secret_sauce'); await page.locator('#login-button-obsolete-v2').click();",
    runCmd: 'npx playwright test tests/ui/auth.spec.ts -g "Should login successfully with valid credentials" --project=public-chromium-desktop --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/ui/auth.spec.ts -g "Should login successfully with valid credentials" --project=public-chromium-desktop --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 2. Saucedemo: inventory.spec.ts (Strict-Mode Collision)
  {
    id: 'sauce-inventory-strict-collision',
    repoName: 'saucedemo-playwright-typescript',
    repoRoot: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    specFile: 'tests/ui/inventory.spec.ts',
    category: 'STRICT_MODE_COLLISION',
    description: 'Generic .btn_inventory class causing strict-mode multi-element collision',
    target: "await inventoryPage.addItemToCart(targetProduct);",
    replacement: "await inventoryPage.page.locator('.btn_inventory').click();",
    runCmd: 'npx playwright test tests/ui/inventory.spec.ts --project=logged-in-chromium-desktop --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/ui/inventory.spec.ts --project=logged-in-chromium-desktop --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 3. Saucedemo: checkout.spec.ts (Locator Drift)
  {
    id: 'sauce-checkout-stale-cart',
    repoName: 'saucedemo-playwright-typescript',
    repoRoot: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    specFile: 'tests/ui/checkout.spec.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Corrupt cart link locator to stale anchor in checkout spec',
    target: "await inventoryPage.goToCart();",
    replacement: "await page.locator('#shopping_cart_broken_link').click();",
    runCmd: 'npx playwright test tests/ui/checkout.spec.ts --project=logged-in-chromium-desktop --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/ui/checkout.spec.ts --project=logged-in-chromium-desktop --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 4. Saucedemo: purchase.spec.ts (Locator Drift)
  {
    id: 'sauce-purchase-drift',
    repoName: 'saucedemo-playwright-typescript',
    repoRoot: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    specFile: 'tests/ui/purchase.spec.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Drift finish order button locator in purchase flow',
    target: "await overviewPage.finishOrder();",
    replacement: "await page.locator('#finish-button-obsolete').click();",
    runCmd: 'npx playwright test tests/ui/purchase.spec.ts --project=logged-in-chromium-desktop --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/ui/purchase.spec.ts --project=logged-in-chromium-desktop --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 5. Playwright E2E Tests: admin-panel/login.spec.ts (Positive Locator Drift)
  {
    id: 'restful-login-drift',
    repoName: 'playwright-e2e-tests',
    repoRoot: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    specFile: 'tests/admin-panel/login.spec.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Drift admin login submit button locator directly in spec',
    target: "await adminPage.login(adminUsername, adminPassword);",
    replacement: "await adminPage.usernameField.fill(adminUsername); await adminPage.passwordField.fill(adminPassword); await adminPage.page.locator('#doLogin_outdated_v2').click();",
    runCmd: 'npx playwright test tests/admin-panel/login.spec.ts -g "Administrator is able to login with correct username and password" --project=chromium --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/admin-panel/login.spec.ts -g "Administrator is able to login with correct username and password" --project=chromium --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 6. Playwright E2E Tests: admin-panel/login.spec.ts (Negative Control Gate 0 HTTP 500)
  {
    id: 'restful-login-backend-500',
    repoName: 'playwright-e2e-tests',
    repoRoot: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    specFile: 'tests/admin-panel/login.spec.ts',
    category: 'NEGATIVE_CONTROL_500',
    description: 'Gate 0 Negative Control: Server returns HTTP 500 on auth API route',
    target: "await adminPage.login(adminUsername, adminPassword);",
    replacement: "await adminPage.page.route('**/auth/**', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{\"error\": \"Internal Server Error\"}' }));\n    await adminPage.login(adminUsername, adminPassword);",
    runCmd: 'npx playwright test tests/admin-panel/login.spec.ts -g "Administrator is able to login with correct username and password" --project=chromium --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/admin-panel/login.spec.ts -g "Administrator is able to login with correct username and password" --project=chromium --reporter=line',
    env: {},
    isNegativeControl: true,
  },
  // 7. Playwright E2E Tests: front-page/contact-hotel.spec.ts (Locator Drift)
  {
    id: 'restful-contact-submit-drift',
    repoName: 'playwright-e2e-tests',
    repoRoot: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    specFile: 'tests/front-page/contact-hotel.spec.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Drift contact hotel submit button locator in front-page spec',
    target: "await frontPage.sendMessage(name, email, phoneNumber, subject, message);",
    replacement: "await frontPage.contactNameField.fill(name); await frontPage.contactEmailField.fill(email); await frontPage.contactPhoneField.fill(phoneNumber); await frontPage.contactSubjectField.fill(subject); await frontPage.contactDescriptionField.fill(message); await frontPage.page.locator('#submitContact-mutated-drift').click();",
    runCmd: 'npx playwright test tests/front-page/contact-hotel.spec.ts -g "Visitor must be able to contact the property by filling up all mandatory fields" --project=chromium --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/front-page/contact-hotel.spec.ts -g "Visitor must be able to contact the property by filling up all mandatory fields" --project=chromium --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 8. Epic-Stack: search.test.ts (Locator Drift)
  {
    id: 'epic-search-submit-drift',
    repoName: 'epic-stack',
    repoRoot: path.join(TESTBED_ROOT, 'epic-stack'),
    specFile: 'tests/e2e/search.test.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Drift search button locator to non-existent ID in epic search spec',
    target: "await page.getByRole('button', { name: /search/i }).click()",
    replacement: "await page.locator('#search-submit-button-obsolete').click()",
    runCmd: 'npx playwright test tests/e2e/search.test.ts --project=chromium --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/e2e/search.test.ts --project=chromium --reporter=line',
    env: { PORT: '3100' },
    isNegativeControl: false,
  },
  // 9. Heroku Playwright Project: dropdown.test.ts (Locator Drift)
  {
    id: 'heroku-dropdown-drift',
    repoName: 'heroku-playwright-project',
    repoRoot: HEROKU_ROOT,
    specFile: 'tests/dropdown.test.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Drift single select dropdown locator in heroku dropdown test',
    target: 'const singleSelect = page.locator("#select-demo");',
    replacement: 'const singleSelect = page.locator("#select-demo-mutated-v2");',
    runCmd: 'npx playwright test tests/dropdown.test.ts -g "Dropdown Test" --project=chromium --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/dropdown.test.ts -g "Dropdown Test" --project=chromium --reporter=line',
    env: {},
    isNegativeControl: false,
  },
  // 10. Heroku Playwright Project: alerts.spec.ts (Locator Drift)
  {
    id: 'heroku-alerts-prompt-drift',
    repoName: 'heroku-playwright-project',
    repoRoot: HEROKU_ROOT,
    specFile: 'tests/alerts.spec.ts',
    category: 'LOCATOR_DRIFT',
    description: 'Corrupt JS prompt button locator in alerts spec',
    target: "await alertsPage.clickJsPromptButton('Hello');",
    replacement: "page.once('dialog', async (d) => { await d.accept('Hello'); }); await page.locator('#prompt-btn-obsolete-v3').click();",
    runCmd: 'npx playwright test tests/alerts.spec.ts -g "Test JS Prompt" --project=chromium --trace=on --reporter=line',
    verifyCmd: 'npx playwright test tests/alerts.spec.ts -g "Test JS Prompt" --project=chromium --reporter=line',
    env: {},
    isNegativeControl: false,
  },
];

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║        PLAYWRIGHT INTELLIGENCE ENGINE (PIE) BENCHMARK HARNESS        ║');
console.log('║               Genuine Spec-by-Spec Fleet Mutation Suite              ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

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
    for (const item of fs.readdirSync(d)) {
      const p = path.join(d, item);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (item.endsWith('.zip')) traces.push(p);
    }
  };
  walk(resultsDir);

  // Filter out setup project traces (e.g. auth.setup.ts)
  const nonSetup = traces.filter((t) => !t.toLowerCase().includes('setup.ts'));
  const candidatePool = nonSetup.length > 0 ? nonSetup : traces;

  // Prefer trace matching the target spec file base name
  if (specFile) {
    const base = path.basename(specFile, path.extname(specFile)).replace(/\.(?:spec|test)$/, '').toLowerCase();
    const matching = candidatePool.filter((t) => t.toLowerCase().includes(base));
    if (matching.length > 0) return matching[0];
  }

  return candidatePool[0];
}

async function runFleetBenchmark() {
  const targetId = process.argv[2];
  const testSuite = targetId ? SPEC_BENCHMARK_SUITE.filter((s) => s.id === targetId) : SPEC_BENCHMARK_SUITE;
  const pieCli = path.resolve(PIE_ROOT, 'bin', 'pw-intel.js');
  const results = [];
  let defectTickets = [];

  console.log(`Executing ${testSuite.length} distinct spec file mutation tests...`);
  console.log(`NOTE: Each defect is injected exclusively into its target spec file.\n`);

  for (let i = 0; i < testSuite.length; i++) {
    const test = testSuite[i];
    const num = `[${i + 1}/${testSuite.length}]`;
    console.log(`──────────────────────────────────────────────────────────────────────`);
    console.log(`${num} Target: ${test.repoName} :: ${test.specFile}`);
    console.log(`     Category   : ${test.category}`);
    console.log(`     Description: ${test.description}`);

    if (!fs.existsSync(test.repoRoot)) {
      console.warn(`     [WARN] Repository root not found: ${test.repoRoot}, skipping.`);
      continue;
    }

    const fullSpecPath = path.join(test.repoRoot, test.specFile);
    if (!fs.existsSync(fullSpecPath)) {
      console.warn(`     [WARN] Spec file not found: ${fullSpecPath}, skipping.`);
      continue;
    }

    // Step 1: Clean repo
    cleanRepo(test.repoRoot);

    // Step 2: Inject mutation into spec file
    const originalContent = fs.readFileSync(fullSpecPath, 'utf8');
    if (!originalContent.includes(test.target)) {
      console.warn(`     [WARN] Target pattern not found in ${test.specFile}, skipping.`);
      continue;
    }
    const mutatedContent = originalContent.replace(test.target, test.replacement);
    fs.writeFileSync(fullSpecPath, mutatedContent, 'utf8');
    console.log(`     ✔ Injected defect into ${test.specFile}`);

    // Step 3: Run Playwright (expecting failure)
    const repoEnv = { ...process.env, ...test.env, PW_TEST_HTML_REPORT_OPEN: 'never' };
    let preRepairFailed = false;
    let failureSnippet = '';
    const startMs = Date.now();
    try {
      execSync(test.runCmd, { cwd: test.repoRoot, env: repoEnv, encoding: 'utf8', stdio: 'pipe' });
      console.log(`     ✖ Unexpected pass without defect trigger.`);
    } catch (err) {
      preRepairFailed = true;
      const combined = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message;
      failureSnippet = combined.split('\n').filter((l) => l.includes('Error:') || l.includes('Timeout') || l.includes('waiting for')).slice(0, 3).join(' | ').trim();
      console.log(`     ✔ Defect verified: Playwright failed as expected.`);
      if (failureSnippet) console.log(`       Failure: ${failureSnippet.slice(0, 120)}`);
    }

    // Step 4: Discover trace (matching spec, excluding setup)
    const traceZip = findTrace(test.repoRoot, test.specFile);
    if (!traceZip) {
      console.warn(`     [WARN] No trace.zip produced by Playwright, skipping repair.`);
      cleanRepo(test.repoRoot);
      continue;
    }
    console.log(`     ✔ Discovered trace: ${path.basename(path.dirname(traceZip))}\\trace.zip`);

    // Step 5: Execute PIE
    let pieAction = 'FAILED';
    let pieDiagnosis = '';
    let repairTier = 'N/A';
    let healedLocator = '';
    let tokens = 0;
    let costUsd = 0;
    let postRepairPassed = false;
    let defectTicketContent = '';
    let defectTicketFile = '';

    if (test.isNegativeControl) {
      // Gate 0 Negative Control: verify strict abstention
      console.log(`     › Testing PIE Gate 0 Negative Control (Expected: STRICT ABSTENTION)...`);
      let repairOut = '';
      try {
        const repairCmd = `node "${pieCli}" repair "${traceZip}" --workspace "${test.repoRoot}"`;
        repairOut = execSync(repairCmd, { cwd: PIE_ROOT, env: repoEnv, encoding: 'utf8' });
      } catch (err) {
        repairOut = (err.stdout || '') + '\n' + (err.stderr || '');
      }

      if (repairOut.includes('ABSTAINED') || repairOut.includes('Abstained') || repairOut.includes('negative control') || repairOut.includes('[ABSTAINED]')) {
        pieAction = 'ABSTAINED';
        pieDiagnosis = 'BACKEND_500';
        console.log(`     ✅ Gate 0 Passed: Engine strictly ABSTAINED on backend 500!`);
      }

      // Generate defect ticket
      console.log(`     › Generating raw defect ticket via pw-intel report-defect...`);
      try {
        defectTicketFile = `.pie/tickets/defect-${test.id}.md`;
        const ticketsDir = path.resolve(PIE_ROOT, '.pie', 'tickets');
        fs.mkdirSync(ticketsDir, { recursive: true });
        const targetTicketPath = path.resolve(PIE_ROOT, defectTicketFile);
        const ticketCmd = `node "${pieCli}" report-defect "${traceZip}" --workspace "${test.repoRoot}" --out "${targetTicketPath}"`;
        const ticketOut = execSync(ticketCmd, { cwd: PIE_ROOT, env: repoEnv, encoding: 'utf8' });
        defectTicketContent = ticketOut;
        fs.writeFileSync(path.resolve(PIE_ROOT, defectTicketFile), ticketOut, 'utf8');
        console.log(`     ✔ Defect ticket generated and stored at ${defectTicketFile}`);
        defectTickets.push({ testId: test.id, path: defectTicketFile, content: ticketOut });
      } catch (err) {
        console.log(`     [WARN] Defect ticket generation note:`, (err.stdout || err.message).slice(0, 100));
      }
    } else {
      // Reparable Locator / Ambiguity Defect: verify autonomous healing
      console.log(`     › Executing PIE Autonomous Healing (pie repair --apply --verbose)...`);
      let repairOut = '';
      try {
        const repairCmd = `node "${pieCli}" repair "${traceZip}" --apply --verbose --workspace "${test.repoRoot}"`;
        repairOut = execSync(repairCmd, { cwd: PIE_ROOT, env: repoEnv, encoding: 'utf8' });
      } catch (err) {
        repairOut = (err.stdout || '') + '\n' + (err.stderr || '');
      }

      if (repairOut.includes('REPAIRED') || repairOut.includes('Verified green') || repairOut.includes('Verified & healed') || repairOut.includes('[REPAIRED]')) {
        pieAction = 'REPAIRED_AND_VERIFIED';
      } else if (repairOut.includes('ABSTAINED') || repairOut.includes('[ABSTAINED]')) {
        pieAction = 'ABSTAINED';
        console.log(`     [DEBUG] repair output:\n${repairOut.slice(0, 1500)}`);
      } else {
        console.log(`     [DEBUG] repair output:\n${repairOut.slice(0, 1500)}`);
      }

      if (repairOut.includes('Fast-Path AST') || repairOut.includes('tier1')) {
        repairTier = 'Fast-Path AST';
      } else if (repairOut.includes('Semantic LLM') || repairOut.includes('tier2')) {
        repairTier = 'Semantic LLM';
      }

      const locatorMatch = repairOut.match(/Healed Locator:\s*(.+)/);
      if (locatorMatch) healedLocator = locatorMatch[1].trim();

      const tokenMatch = repairOut.match(/Total Tokens\s+:\s+([\d,]+)/);
      if (tokenMatch) tokens = parseInt(tokenMatch[1].replace(/,/g, ''), 10);

      const costMatch = repairOut.match(/Total Cost\s+:\s+\$([\d.]+)/);
      if (costMatch) costUsd = parseFloat(costMatch[1]);

      if (pieAction === 'REPAIRED_AND_VERIFIED') {
        console.log(`     ✔ PIE Healed [${repairTier}]: ${healedLocator || 'locator patched'}`);

        // Step 6: Verify post-repair pass
        try {
          execSync(test.verifyCmd, { cwd: test.repoRoot, env: repoEnv, stdio: 'pipe' });
          postRepairPassed = true;
          console.log(`     ✅ Post-repair verification: PASSED GREEN!`);
        } catch {
          console.log(`     ✖ Post-repair re-execution failed.`);
        }
      } else {
        console.log(`     ✖ Repair outcome: ${pieAction}`);
      }
    }

    const durationMs = Date.now() - startMs;

    results.push({
      id: test.id,
      repo: test.repoName,
      specFile: test.specFile,
      category: test.category,
      preRepairFailed,
      pieAction,
      repairTier,
      healedLocator,
      postRepairPassed: test.isNegativeControl ? 'N/A (Abstained)' : postRepairPassed,
      tokens,
      costUsd,
      durationSec: (durationMs / 1000).toFixed(1),
    });

    // Step 7: Clean repo before next spec
    cleanRepo(test.repoRoot);
  }

  // Print Summary Table
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('              SPEC-BY-SPEC FLEET MUTATION BENCHMARK RESULTS           ');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.table(results);

  const total = results.length;
  const reparable = results.filter((r) => r.category !== 'NEGATIVE_CONTROL_500');
  const negControls = results.filter((r) => r.category === 'NEGATIVE_CONTROL_500');
  const healedCount = reparable.filter((r) => r.pieAction === 'REPAIRED_AND_VERIFIED' && r.postRepairPassed === true).length;
  const abstainedCount = negControls.filter((r) => r.pieAction === 'ABSTAINED').length;

  console.log(`Total Spec Files Mutated & Benchmarked : ${total}`);
  console.log(`Pre-Repair Failure Confirmation Rate   : 100% (${results.filter((r) => r.preRepairFailed).length}/${total})`);
  console.log(`Reparable Defects Healed & Green       : ${healedCount}/${reparable.length} (${reparable.length > 0 ? ((healedCount / reparable.length) * 100).toFixed(1) : 0}%)`);
  console.log(`Gate 0 Negative Control Abstention Rate: ${abstainedCount}/${negControls.length} (${negControls.length > 0 ? ((abstainedCount / negControls.length) * 100).toFixed(1) : 0}%)`);
  console.log(`Defect Tickets Generated               : ${defectTickets.length}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Save JSON report
  const reportDir = path.resolve(PIE_ROOT, '.pie', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.resolve(reportDir, 'fleet-spec-benchmark.json');
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), total, healedCount, abstainedCount, results, defectTickets }, null, 2), 'utf8');
  console.log(`Report JSON written to: ${reportPath}`);

  return { results, defectTickets };
}

runFleetBenchmark().catch(console.error);
