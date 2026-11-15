import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const TESTBED_ROOT = 'D:\\Work\\pie-real-repository-testbed\\repositories';
const HEROKU_ROOT = 'D:\\Work\\heroku-playwright-project';

const MUTATIONS = [
  // 1. Saucedemo
  {
    repo: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    file: 'tests/ui/auth.spec.ts',
    target: "await loginPage.login('locked_out_user', 'secret_sauce');",
    replacement: "await page.waitForTimeout(1500);\n    // DEFECT: Injected obsolete submit button locator\n    await page.locator('#login-button-obsolete-v2').click();",
  },
  {
    repo: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    file: 'tests/ui/inventory.spec.ts',
    target: "await inventoryPage.addItemToCart(targetProduct);",
    replacement: "await page.waitForTimeout(2500);\n    // DEFECT: Strict-mode collision (matches 6 items)\n    await page.locator('.btn_inventory').click();",
  },
  {
    repo: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    file: 'tests/ui/checkout.spec.ts',
    target: "await inventoryPage.goToCart();",
    replacement: "// DEFECT: Stale cart locator\n    await page.locator('#shopping_cart_broken_link').click();",
  },
  {
    repo: path.join(TESTBED_ROOT, 'saucedemo-playwright-typescript'),
    file: 'tests/ui/purchase.spec.ts',
    target: "await overviewPage.finishOrder();",
    replacement: "await page.waitForTimeout(2000);\n    // DEFECT: Drifted finish button\n    await page.locator('#finish-button-obsolete').click();",
  },

  // 2. Heroku Playwright Project
  {
    repo: HEROKU_ROOT,
    file: 'tests/dropdown.test.ts',
    target: 'const singleSelect = page.locator("#select-demo");',
    replacement: '// DEFECT: Locator drift\n    const singleSelect = page.locator("#select-demo-mutated-v2");',
  },
  {
    repo: HEROKU_ROOT,
    file: 'tests/dropdown.test.ts',
    target: 'const multiSelect = page.locator("#multi-select");',
    replacement: '// DEFECT: Strict mode violation\n    const multiSelect = page.locator("select");',
  },
  {
    repo: HEROKU_ROOT,
    file: 'tests/alerts.test.ts',
    target: 'await page.locator("button:has-text(\'Click for JS Prompt\')").click();',
    replacement: '// DEFECT: Locator drift on JS prompt button\n    await page.locator("#prompt-btn-obsolete-v3").click();',
  },
  {
    repo: HEROKU_ROOT,
    file: 'tests/upload.spec.ts',
    target: 'await page.locator("#file-submit").click();',
    replacement: '// DEFECT: Stale file submit locator\n    await page.locator("#file-submit-broken-2026").click();',
  },

  // 3. Playwright E2E Tests (Restful Booker)
  {
    repo: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    file: 'pages/AdminPage.ts',
    target: "this.loginButton = page.locator('#doLogin');",
    replacement: "// DEFECT: Locator drift on admin login button\n    this.loginButton = page.locator('#doLogin_outdated_v2');",
  },
  {
    repo: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    file: 'tests/admin-panel/login.spec.ts',
    target: "await adminPage.login('', 'password');",
    replacement: "// DEFECT: Negative Control (Backend 500 error)\n    await page.route('**/auth/**', route => route.fulfill({ status: 500, body: '{\"error\": \"Internal Server Error\"}' }));\n    await adminPage.login('', 'password');",
  },
  {
    repo: path.join(TESTBED_ROOT, 'playwright-e2e-tests'),
    file: 'tests/front-page/contact-hotel.spec.ts',
    target: "await this.submitButton.click();",
    replacement: "// DEFECT: Contact form submit drift\n    await this.page.locator('#submitContact-mutated').click();",
  },

  // 4. Epic Stack (Remix + SQLite)
  {
    repo: path.join(TESTBED_ROOT, 'epic-stack'),
    file: 'tests/e2e/search.test.ts',
    target: "await page.getByRole('button', { name: /search/i }).click()",
    replacement: "// DEFECT: Locator drift on search submit\n\tawait page.locator('#search-submit-button-obsolete').click()",
  },
  {
    repo: path.join(TESTBED_ROOT, 'epic-stack'),
    file: 'tests/e2e/static-files.test.ts',
    target: "await page.goto('/')",
    replacement: "await page.goto('/')\n\t// DEFECT: Stale footer logo locator\n\tawait page.locator('#stale-footer-logo-img').waitFor({ timeout: 5000 })",
  },
];

const action = process.argv[2] || 'inject';

if (action === 'restore') {
  console.log('[Fleet Mutation Injector] Reverting all repositories to clean git state...');
  const repos = new Set(MUTATIONS.map(m => m.repo));
  for (const r of repos) {
    if (!fs.existsSync(r)) continue;
    try {
      console.log(`  • Cleaning ${path.basename(r)}...`);
      execSync('git checkout -- .', { cwd: r, stdio: 'ignore' });
      execSync('git clean -fd', { cwd: r, stdio: 'ignore' });
    } catch (err) {
      console.error(`Failed to clean ${r}:`, err.message);
    }
  }
  console.log('[Fleet Mutation Injector] All repositories restored to pristine state.');
  process.exit(0);
}

if (action === 'inject') {
  console.log('[Fleet Mutation Injector] Injecting controlled multi-category mutations across fleet...');
  let count = 0;
  for (const m of MUTATIONS) {
    const targetFilePath = path.join(m.repo, m.file);
    if (!fs.existsSync(targetFilePath)) {
      console.warn(`[WARN] File not found: ${targetFilePath}`);
      continue;
    }
    const content = fs.readFileSync(targetFilePath, 'utf8');
    if (!content.includes(m.target)) {
      console.warn(`[WARN] Target pattern not found in ${m.file} (may already be mutated)`);
      continue;
    }
    const mutated = content.replace(m.target, m.replacement);
    fs.writeFileSync(targetFilePath, mutated, 'utf8');
    console.log(`  ✔ Injected defect into ${path.basename(m.repo)} :: ${m.file}`);
    count++;
  }
  console.log(`[Fleet Mutation Injector] Done! Injected ${count} defect mutations across fleet.`);
}
