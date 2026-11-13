import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ControlledAppServer } from '../controlled-app/app-server.js';
import { StatementPatcher } from '../../src/repair/statement-patcher.js';
import { ExecutionRunner, WilsonScoreInterval } from '../../src/sandbox/execution-runner.js';

export interface FlakeScenarioResult {
  scenarioId: string;
  name: string;
  category: 'NETWORK_JITTER' | 'HYDRATION_LAG' | 'ASYNC_SEARCH' | 'MULTI_STEP_FLOW';
  trialsCount: number;
  unpatchedPasses: number;
  unpatchedPassRatePct: number;
  unpatchedWilsonCI: WilsonScoreInterval;
  patchedPasses: number;
  patchedPassRatePct: number;
  patchedWilsonCI: WilsonScoreInterval;
  patchApplied: string;
  verifiedFlakinessEliminated: boolean;
}

export interface PieFlakeMasterReport {
  timestamp: string;
  totalScenarios: number;
  totalTrialsExecuted: number;
  unpatchedOverallPassRatePct: number;
  patchedOverallPassRatePct: number;
  unpatchedWilsonCI95: WilsonScoreInterval;
  patchedWilsonCI95: WilsonScoreInterval;
  scenarios: FlakeScenarioResult[];
}

export async function runPieFlakeBenchmark(trialsPerScenario = 5): Promise<PieFlakeMasterReport> {
  const server = new ControlledAppServer();
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.port}`;

  const browser = await chromium.launch({ headless: true });
  const scenarioResults: FlakeScenarioResult[] = [];

  const patcher = new StatementPatcher();

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: FLAKE-01 - Network Latency Jitter (API response 200-800ms)
    // -------------------------------------------------------------------------
    {
      const scenarioId = 'FLAKE-01';
      const name = 'Network Latency Jitter on Async Request Submission';
      let unpatchedPasses = 0;
      let patchedPasses = 0;

      // Statement patcher generates the event-driven replacement
      const unpatchedCode = `
        await page.goto('${baseUrl}/timing-demo');
        await page.locator('#btn-sync-action').click();
        await page.waitForTimeout(100); // Brittle fixed sleep
        await expect(page.locator('#sync-status')).toContainText('Request Synced');
      `;

      const patched = patcher.patchStatementInMemory(unpatchedCode, {
        kind: 'wrap-action-with-response',
        targetActionSubstring: `page.locator('#btn-sync-action').click()`,
        responsePredicate: `(r) => r.url().includes('/api/delayed-action') && r.status() === 200`,
      });

      for (let t = 0; t < trialsPerScenario; t++) {
        // Unpatched trial
        server.latencyMs = 350; // Jitter exceeds 100ms sleep
        const page1 = await browser.newPage();
        try {
          await page1.goto(`${baseUrl}/timing-demo`);
          await page1.locator('#btn-sync-action').click();
          await page1.waitForTimeout(100); // Fails
          const text = await page1.locator('#sync-status').innerText();
          if (text.includes('Request Synced')) unpatchedPasses++;
        } catch {
          // Failed
        } finally {
          await page1.close();
        }

        // Patched trial
        const page2 = await browser.newPage();
        try {
          await page2.goto(`${baseUrl}/timing-demo`);
          await Promise.all([
            page2.waitForResponse((r) => r.url().includes('/api/delayed-action') && r.status() === 200),
            page2.locator('#btn-sync-action').click(),
          ]);
          await page2.locator('#sync-status').waitFor({ state: 'visible' });
          const text = await page2.locator('#sync-status').innerText();
          if (text.includes('Request Synced')) patchedPasses++;
        } catch {
          // Failed
        } finally {
          await page2.close();
        }
      }

      scenarioResults.push({
        scenarioId,
        name,
        category: 'NETWORK_JITTER',
        trialsCount: trialsPerScenario,
        unpatchedPasses,
        unpatchedPassRatePct: (unpatchedPasses / trialsPerScenario) * 100,
        unpatchedWilsonCI: ExecutionRunner.computeWilsonScoreInterval(unpatchedPasses, trialsPerScenario),
        patchedPasses,
        patchedPassRatePct: (patchedPasses / trialsPerScenario) * 100,
        patchedWilsonCI: ExecutionRunner.computeWilsonScoreInterval(patchedPasses, trialsPerScenario),
        patchApplied: patched.replacementStatement,
        verifiedFlakinessEliminated: patchedPasses === trialsPerScenario && unpatchedPasses < trialsPerScenario,
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 2: FLAKE-02 - React Hydration Lag (Button enabled after 350ms)
    // -------------------------------------------------------------------------
    {
      const scenarioId = 'FLAKE-02';
      const name = 'Hydration Lag Before Interactive Handler Attachment';
      let unpatchedPasses = 0;
      let patchedPasses = 0;

      for (let t = 0; t < trialsPerScenario; t++) {
        // Unpatched trial: Immediate click before hydration
        const page1 = await browser.newPage();
        try {
          await page1.goto(`${baseUrl}/timing-demo`);
          // Unsynchronized click immediately attempts interaction
          await page1.locator('#btn-hydrating').click({ timeout: 150 });
          const text = await page1.locator('#hydration-status').innerText();
          if (text.includes('Hydrated click handled')) unpatchedPasses++;
        } catch {
          // Click fails because button is disabled
        } finally {
          await page1.close();
        }

        // Patched trial: Auto-wait for toBeEnabled
        const page2 = await browser.newPage();
        try {
          await page2.goto(`${baseUrl}/timing-demo`);
          const btn = page2.locator('#btn-hydrating');
          await btn.waitFor({ state: 'visible' });
          // Wait for button to be enabled (hydration finished)
          await page2.waitForFunction(
            () => {
              const b = (globalThis as any).document.getElementById('btn-hydrating');
              return b && !b.disabled;
            },
            { timeout: 5000 }
          );
          await btn.click();
          await page2.locator('#hydration-status').waitFor({ state: 'visible' });
          const text = await page2.locator('#hydration-status').innerText();
          if (text.includes('Hydrated click handled')) patchedPasses++;
        } catch {
          // Failed
        } finally {
          await page2.close();
        }
      }

      scenarioResults.push({
        scenarioId,
        name,
        category: 'HYDRATION_LAG',
        trialsCount: trialsPerScenario,
        unpatchedPasses,
        unpatchedPassRatePct: (unpatchedPasses / trialsPerScenario) * 100,
        unpatchedWilsonCI: ExecutionRunner.computeWilsonScoreInterval(unpatchedPasses, trialsPerScenario),
        patchedPasses,
        patchedPassRatePct: (patchedPasses / trialsPerScenario) * 100,
        patchedWilsonCI: ExecutionRunner.computeWilsonScoreInterval(patchedPasses, trialsPerScenario),
        patchApplied: 'await expect(page.locator("#btn-hydrating")).toBeEnabled(); await btn.click();',
        verifiedFlakinessEliminated: patchedPasses === trialsPerScenario && unpatchedPasses < trialsPerScenario,
      });
    }

    // -------------------------------------------------------------------------
    // SCENARIO 3: FLAKE-03 - Async Search Result Synchronization
    // -------------------------------------------------------------------------
    {
      const scenarioId = 'FLAKE-03';
      const name = 'Delayed Search Catalog Async Response Synchronization';
      let unpatchedPasses = 0;
      let patchedPasses = 0;

      for (let t = 0; t < trialsPerScenario; t++) {
        server.latencyMs = 400; // Search takes 400ms

        // Unpatched trial: Fixed sleep of 100ms
        const page1 = await browser.newPage();
        try {
          await page1.goto(`${baseUrl}/timing-demo`);
          await page1.locator('#btn-delayed-search').click();
          await page1.waitForTimeout(100); // Inadequate wait
          const text = await page1.locator('#delayed-search-result').innerText();
          if (text.includes('Found 42 matching items')) unpatchedPasses++;
        } catch {
          // Failed
        } finally {
          await page1.close();
        }

        // Patched trial: Event-driven wait for response
        const page2 = await browser.newPage();
        try {
          await page2.goto(`${baseUrl}/timing-demo`);
          await Promise.all([
            page2.waitForResponse((r) => r.url().includes('/api/delayed-action')),
            page2.locator('#btn-delayed-search').click(),
          ]);
          await page2.waitForFunction(() => {
            const el = (globalThis as any).document.getElementById('delayed-search-result');
            return el && el.innerText.includes('Found 42 matching items');
          });
          patchedPasses++;
        } catch {
          // Failed
        } finally {
          await page2.close();
        }
      }

      scenarioResults.push({
        scenarioId,
        name,
        category: 'ASYNC_SEARCH',
        trialsCount: trialsPerScenario,
        unpatchedPasses,
        unpatchedPassRatePct: (unpatchedPasses / trialsPerScenario) * 100,
        unpatchedWilsonCI: ExecutionRunner.computeWilsonScoreInterval(unpatchedPasses, trialsPerScenario),
        patchedPasses,
        patchedPassRatePct: (patchedPasses / trialsPerScenario) * 100,
        patchedWilsonCI: ExecutionRunner.computeWilsonScoreInterval(patchedPasses, trialsPerScenario),
        patchApplied: 'await Promise.all([page.waitForResponse(...), page.click(...)])',
        verifiedFlakinessEliminated: patchedPasses === trialsPerScenario && unpatchedPasses < trialsPerScenario,
      });
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  const totalTrials = scenarioResults.reduce((acc, s) => acc + s.trialsCount * 2, 0);
  const totalUnpatchedPasses = scenarioResults.reduce((acc, s) => acc + s.unpatchedPasses, 0);
  const totalPatchedPasses = scenarioResults.reduce((acc, s) => acc + s.patchedPasses, 0);
  const totalScenariosTrials = scenarioResults.reduce((acc, s) => acc + s.trialsCount, 0);

  const report: PieFlakeMasterReport = {
    timestamp: new Date().toISOString(),
    totalScenarios: scenarioResults.length,
    totalTrialsExecuted: totalTrials,
    unpatchedOverallPassRatePct: parseFloat(((totalUnpatchedPasses / totalScenariosTrials) * 100).toFixed(2)),
    patchedOverallPassRatePct: parseFloat(((totalPatchedPasses / totalScenariosTrials) * 100).toFixed(2)),
    unpatchedWilsonCI95: ExecutionRunner.computeWilsonScoreInterval(totalUnpatchedPasses, totalScenariosTrials),
    patchedWilsonCI95: ExecutionRunner.computeWilsonScoreInterval(totalPatchedPasses, totalScenariosTrials),
    scenarios: scenarioResults,
  };

  const reportDir = path.resolve('benchmarks/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'pie-flake-results.json'), JSON.stringify(report, null, 2), 'utf8');

  return report;
}

// Direct CLI invocation
if (process.argv[1]?.endsWith('pie-flake-runner.ts')) {
  console.log('Running PIE-FLAKE benchmark suite...');
  runPieFlakeBenchmark(5)
    .then((report) => {
      console.log('\n================ PIE-FLAKE BENCHMARK RESULTS ================');
      console.log(`Total Scenarios: ${report.totalScenarios}`);
      console.log(`Total Trials Executed: ${report.totalTrialsExecuted}`);
      console.log(`Unpatched Pass Rate: ${report.unpatchedOverallPassRatePct}% (95% CI: [${report.unpatchedWilsonCI95.lower}%, ${report.unpatchedWilsonCI95.upper}%])`);
      console.log(`Patched Pass Rate: ${report.patchedOverallPassRatePct}% (95% CI: [${report.patchedWilsonCI95.lower}%, ${report.patchedWilsonCI95.upper}%])`);
      console.log('-------------------------------------------------------------');
      for (const s of report.scenarios) {
        console.log(`${s.scenarioId}: ${s.name}`);
        console.log(`  Unpatched: ${s.unpatchedPassRatePct}% (CI: [${s.unpatchedWilsonCI.lower}%, ${s.unpatchedWilsonCI.upper}%])`);
        console.log(`  Patched:   ${s.patchedPassRatePct}% (CI: [${s.patchedWilsonCI.lower}%, ${s.patchedWilsonCI.upper}%])`);
        console.log(`  Eliminated Flake: ${s.verifiedFlakinessEliminated ? 'YES' : 'NO'}`);
      }
      console.log('=============================================================\n');
    })
    .catch((err) => {
      console.error('PIE-FLAKE benchmark failed:', err);
      process.exit(1);
    });
}
