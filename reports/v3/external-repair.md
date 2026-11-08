# PIE v3.0 Real External Repository Repair Evidence

**Testbed Repository:** `d:\Work\pie-real-repository-testbed\mutations\variants\MUT-01-accessible-name-change`  
**Execution Timestamp:** 2026-11-08  
**Trace Artifact:** `d:\Work\pie-real-repository-testbed\generated-test-data\traces\MUT-01-accessible-name-change--admin-panel-login-Login-Te-0b737-e-and-password-sanity-login-chromium--trace.zip`  
**Verification Method:** Isolated Child-Process Git Worktree Execution (`ExecutionRunner.run('npx', ...)`)  

---

## 1. Failure Diagnosis (Gate A)

### Trace Evidence
- **Call ID:** `cpva@56`
- **Method:** `click`
- **Failed Selector:** `getByRole('button', { name: 'Sign in to Portal' })`
- **Error:** `Error: locator.click: Test timeout of 60000ms exceeded. Call log: waiting for getByRole('button', { name: 'Sign in to Portal' })`
- **Root Cause Classification:** `LOCATOR_DRIFT` (Confidence: 93.0%)
- **Source Location:** `pages/AdminPage.ts:16:30` (`this.loginButton`)

### Candidate Extraction & Scoring
- **Extracted DOM Element:** `<button type="submit" id="doLogin" class="btn btn-primary mt-3">Login</button>`
- **Role:** `button`
- **Accessible Name:** `Login`
- **Candidate Locator Expression:** `page.getByRole('button', { name: 'Login' })`
- **Confidence Score:** `0.885`

---

## 2. Isolated Worktree Execution (Gate B)

### Worktree Details
- **Worktree ID:** `repair-mw7ksxma-fovbf`
- **Worktree Directory:** `d:\Work\pie-real-repository-testbed\mutations\variants\MUT-01-accessible-name-change\.pw-intelligence\worktrees\repair-mw7ksxma-fovbf`
- **Branch:** `pw-repair/repair-mw7ksxma-fovbf`
- **Isolation Strategy:** NTFS hardlink / junction (`node_modules` preserved without re-downloading)

### AST Patch Applied In Isolation
```diff
--- pages/AdminPage.ts (original)
+++ pages/AdminPage.ts (worktree)
@@ -13,7 +13,7 @@
     this.pageHeader = page.getByRole('heading', { name: 'Login' });
     this.usernameField = page.locator('#username');
     this.passwordField = page.locator('#password');
-    this.loginButton = page.getByRole('button', { name: 'Sign in to Portal' });
+    this.loginButton = page.getByRole('button', { name: 'Login' });
     this.alertDanger = page.locator('.alert-danger');
   }
```

---

## 3. Real Execution Proof (Gate C)

### Child-Process Execution
- **Command:** `npx playwright test tests/admin-panel/login.spec.ts --config playwright.config.ts --project chromium`
- **Exit Code:** `0`
- **Duration:** `10,452 ms`
- **Real Playwright Output:**
```
Running 4 tests using 4 workers

[1/4] [chromium] › tests\admin-panel\login.spec.ts:31:7 › Login Tests › User is not able to login with wrong password @login
[2/4] [chromium] › tests\admin-panel\login.spec.ts:19:7 › Login Tests › User is not able to login with empty username @login
[3/4] [chromium] › tests\admin-panel\login.spec.ts:25:7 › Login Tests › User is not able to login with empty password @login
[4/4] [chromium] › tests\admin-panel\login.spec.ts:9:7 › Login Tests › Administrator is able to login with correct username and password @sanity @login
  ok 2 [chromium] › tests\admin-panel\login.spec.ts:19:7 › Login Tests › User is not able to login with empty username @login (2.1s)
  ok 3 [chromium] › tests\admin-panel\login.spec.ts:25:7 › Login Tests › User is not able to login with empty password @login (2.5s)
  ok 1 [chromium] › tests\admin-panel\login.spec.ts:31:7 › Login Tests › User is not able to login with wrong password @login (2.6s)
  ok 4 [chromium] › tests\admin-panel\login.spec.ts:9:7 › Login Tests › Administrator is able to login with correct username and password @sanity @login (2.8s)

  4 passed (6.0s)
```

---

## 4. Invariant Verification & Cryptographic Provenance

- **Intent Invariant v2:** $V = A \land T \land F \land I \land D \land E$
  - Assertions Preserved ($A$): `true` (Original assertions: 7, Current assertions: 7)
  - Test Body Preserved ($T$): `true`
  - Fixtures Preserved ($F$): `true`
  - Identity Preserved ($I$): `true` (`Sign in to Portal` $\rightarrow$ `Login` confirmed as identical login action)
  - Diff Allowlist Passed ($D$): `true` (Only `loginButton` modified within `AdminPage`)
  - Execution Verified ($E$): `true` (Real Playwright test exited with `0`, 4/4 tests passed)
- **Original Source SHA-256:** `33282aa4886364f3d9d236998f2e27342455f90f65d5cd2bcb9c645f9be25589`
- **Modified Source SHA-256:** `367d411e295e2fa53432c6b3c7ee2b9495527e813e1183d78d5b50d9897ebe10`
- **Proposal ID:** `prop-1794126861236-dcfe0767ea50bc2f`
- **Status:** `VERIFIED_READY_FOR_APPROVAL`
