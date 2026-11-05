import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { McpServer } from '../mcp/server.js';
import { TestGenerator } from '../generator/test-generator.js';
import { DiagnosticRerunner } from '../reproduce/diagnostic-rerunner.js';
import { ApprovalService } from '../repair/approval-service.js';
import { WorkspacePromoter } from '../repair/workspace-promoter.js';

export async function runCli(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log('0.1.0');
    return;
  }

  if (command === 'mcp') {
    const server = new McpServer();
    server.start();
    return;
  }

  if (command === 'diagnose') {
    const tracePath = argv[3];
    if (!tracePath) {
      console.error('Error: trace.zip path required. Usage: pw-intel diagnose <path-to-trace.zip>');
      process.exit(1);
    }

    try {
      const { traceEntryName, networkEntryName } = ArchiveReader.findTraceFileEntries(tracePath);
      if (!traceEntryName) {
        throw new Error(`No .trace event stream found in archive '${tracePath}'`);
      }

      const traceText = await ArchiveReader.readEntryAsText(tracePath, traceEntryName);
      const networkText = networkEntryName
        ? await ArchiveReader.readEntryAsText(tracePath, networkEntryName)
        : '';

      const traceLines = traceText.split('\n');
      const networkLines = networkText.split('\n');
      const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
      const correlated = EvidenceCorrelator.correlate(context);
      const report = DiagnosticReportGenerator.generateTerminalReport(correlated);

      console.log(report);
    } catch (err: any) {
      console.error(`Diagnostic execution failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'reproduce') {
    const specFile = argv[3];
    if (!specFile) {
      console.error('Error: spec file path required. Usage: pw-intel reproduce <specFilePath>');
      process.exit(1);
    }

    try {
      console.log(`Running diagnostic reproduction for '${specFile}'...`);
      const result = await DiagnosticRerunner.rerunAndDiagnose({
        specFilePath: specFile,
        workspaceRoot: process.cwd(),
      });

      console.log(result.report);
      if (!result.passed) {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Reproduction execution failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'benchmark') {
    const isWindows = process.platform === 'win32';
    const benchmarkScript = path.resolve(process.cwd(), 'benchmarks', 'runner', 'master-benchmark-runner.ts');
    let executable = 'npx';
    let finalArgs = ['tsx', benchmarkScript, ...argv.slice(3)];

    if (isWindows) {
      const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
      if (fs.existsSync(npxCli)) {
        executable = process.execPath;
        finalArgs = [npxCli, 'tsx', benchmarkScript, ...argv.slice(3)];
      } else {
        executable = 'cmd.exe';
        finalArgs = ['/d', '/s', '/c', 'npx', 'tsx', benchmarkScript, ...argv.slice(3)];
      }
    }

    const child = spawn(executable, finalArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  if (command === 'doctor') {
    await runDoctor();
    return;
  }

  if (command === 'approve') {
    const proposalId = argv[3];
    if (!proposalId) {
      console.error('Error: proposalId required. Usage: pw-intel approve <proposalId>');
      process.exit(1);
    }

    const proposal = ApprovalService.getInstance().getProposal(proposalId);
    if (!proposal) {
      console.error(`Error: Proposal '${proposalId}' not found or expired.`);
      process.exit(1);
    }

    console.log('========================================================================');
    console.log(' PLAYWRIGHT INTELLIGENCE ENGINE — OPERATOR REPAIR APPROVAL');
    console.log('========================================================================\n');
    console.log(`Proposal ID      : ${proposal.proposalId}`);
    console.log(`Target File      : ${proposal.targetFilePath}`);
    console.log(`Target Class     : ${proposal.targetClassName}`);
    console.log(`Target Member    : ${proposal.targetMemberName}`);
    console.log(`Original Hash    : ${proposal.originalSourceHash.slice(0, 16)}...`);
    console.log(`Patched Hash     : ${proposal.patchedSourceHash.slice(0, 16)}...`);
    console.log(`Worktree Status  : ${proposal.worktreeExecutionVerified ? 'VERIFIED (Target test passed in isolated worktree)' : 'UNVERIFIED'}`);
    console.log('\n--- Proposed Unified Diff ---');
    console.log(proposal.fullDiff || '(No diff recorded)');
    console.log('-----------------------------\n');

    if (!proposal.worktreeExecutionVerified) {
      console.error('Security Violation: Cannot authorize proposal. Worktree test execution was not verified.');
      process.exit(1);
    }

    try {
      const tokenPayload = ApprovalService.getInstance().authorizeProposal({ proposalId });
      console.log('PROPOSAL AUTHORIZED.');
      console.log(`Single-Use Approval Token: ${tokenPayload.tokenId}\n`);
      console.log(`To atomically apply this patch to your workspace, run:`);
      console.log(`  pw-intel promote --token ${tokenPayload.tokenId}\n`);
    } catch (err: any) {
      console.error(`Authorization failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'promote') {
    const tokenIndex = argv.indexOf('--token');
    const token = tokenIndex !== -1 ? argv[tokenIndex + 1] : undefined;
    if (!token) {
      console.error('Error: --token argument required. Usage: pw-intel promote --token <approvalToken>');
      process.exit(1);
    }

    const tokenPayload = ApprovalService.getInstance().getTokenPayload(token);
    if (!tokenPayload) {
      console.error(`Error: Invalid or expired approval token '${token}'.`);
      process.exit(1);
    }

    const proposal = ApprovalService.getInstance().getProposal(tokenPayload.proposalId);
    if (!proposal) {
      console.error(`Error: Staged proposal '${tokenPayload.proposalId}' no longer available.`);
      process.exit(1);
    }

    console.log(`Applying authorized repair to '${tokenPayload.targetFilePath}'...`);
    const promoResult = await WorkspacePromoter.promote({
      targetFilePath: tokenPayload.targetFilePath,
      workspaceRoot: process.cwd(),
      patchedContent: proposal.patchedSource,
      approvalTokenPayload: tokenPayload,
    });

    if (!promoResult.success) {
      console.error(`Promotion failed: ${promoResult.error}`);
      process.exit(1);
    }

    console.log(`Successfully promoted verified repair!`);
    console.log(`Target File   : ${promoResult.targetFilePath}`);
    console.log(`Bytes Written : ${promoResult.bytesWritten}`);
    console.log(`Final Hash    : ${promoResult.finalHash.slice(0, 16)}...`);
    return;
  }

  if (command === 'generate') {
    const featureName = argv[3] ?? 'Dashboard';
    const suite = TestGenerator.generateSuite(featureName, [
      { action: 'fill', name: 'Search', value: 'query' },
      { action: 'click', role: 'button', name: 'Submit' },
      { action: 'assert-visible', role: 'heading', name: 'Results' },
    ]);

    console.log(`Generated Page Object (${suite.pageObjectName}.ts):`);
    console.log(suite.pageObjectCode);
    console.log('─────────────────────────────────────────────────────────────────');
    console.log(`Generated Spec:`);
    console.log(suite.specCode);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function runDoctor(): Promise<void> {
  console.log('Running Playwright Intelligence Engine Diagnostic Healthcheck (pw-intel doctor)...\n');
  let healthy = true;

  // 1. Node.js version
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0] || '0', 10);
  if (major >= 20) {
    console.log(`  ✓ Node.js Runtime     : v${nodeVer} (Supported >= 20.0.0)`);
  } else {
    console.log(`  ✗ Node.js Runtime     : v${nodeVer} (Unsupported, requires Node >= 20.0.0)`);
    healthy = false;
  }

  // 2. Git CLI availability
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8' }).trim();
    console.log(`  ✓ Git Version Control : ${gitVer}`);
  } catch {
    console.log(`  ✗ Git Version Control : Not found in PATH (Required for isolated worktrees)`);
    healthy = false;
  }

  // 3. Playwright availability
  let pwFound = false;
  try {
    const cwdPkg = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(cwdPkg)) {
      const pkg = JSON.parse(fs.readFileSync(cwdPkg, 'utf-8'));
      const pwVer = pkg.devDependencies?.['@playwright/test'] || pkg.dependencies?.['@playwright/test'];
      if (pwVer) {
        console.log(`  ✓ Playwright Test     : ${pwVer} (Found in package.json)`);
        pwFound = true;
      }
    }
  } catch {}
  if (!pwFound) {
    try {
      const pwCliVer = execSync('npx --no-install playwright --version', {
        encoding: 'utf-8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      console.log(`  ✓ Playwright CLI      : ${pwCliVer}`);
      pwFound = true;
    } catch {
      console.log(`  ! Playwright Test     : Not detected in current working directory (Optional for offline trace analysis)`);
    }
  }

  // 4. Workspace write access
  try {
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    console.log(`  ✓ Workspace Access    : Read/Write verified for '${process.cwd()}'`);
  } catch {
    console.log(`  ✗ Workspace Access    : Permission denied writing to '${process.cwd()}'`);
    healthy = false;
  }

  // 5. Host platform info
  console.log(`  ✓ Host Platform       : ${process.platform} (${process.arch})`);

  console.log('\nHealthcheck Verdict: ' + (healthy ? 'HEALTHY (Ready for diagnostic and repair workflows)' : 'DEGRADED (Check failed items above)'));
  if (!healthy) {
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Playwright Intelligence Engine CLI (pw-intel)

Usage:
  pw-intel doctor                   Inspects host environment, Node, Git, Playwright & workspace readiness
  pw-intel diagnose <trace.zip>     Diagnoses a Playwright trace archive and outputs root cause
  pw-intel reproduce <spec.ts>      Reruns a failing test with live multi-source diagnostic instrumentation
  pw-intel approve <proposalId>     Human review and cryptographic authorization of staged repair proposal
  pw-intel promote --token <token>  Atomically applies authorized repair proposal to active workspace
  pw-intel benchmark [options]      Executes empirical real browser benchmark suite against Controlled App Server
  pw-intel mcp                      Starts the Model Context Protocol (MCP) JSON-RPC server on stdio
  pw-intel generate <featureName>   Generates verified Page Object and Spec scaffolding
  pw-intel --help                   Shows this help message

Benchmark Options:
  --family <name>                   Filter mutation scenarios by family name (e.g. "Dynamic IDs")
  --scenario <id>                   Filter negative control scenarios by category or name
  --browser <browser>               Target browser (default: chromium)
`);
}

