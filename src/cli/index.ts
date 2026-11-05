import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { McpServer } from '../mcp/server.js';
import { TestGenerator } from '../generator/test-generator.js';
import { DiagnosticRerunner } from '../reproduce/diagnostic-rerunner.js';

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

function printHelp(): void {
  console.log(`
Playwright Intelligence Engine CLI (pw-intel)

Usage:
  pw-intel diagnose <trace.zip>     Diagnoses a Playwright trace archive and outputs root cause
  pw-intel reproduce <spec.ts>      Reruns a failing test with live multi-source diagnostic instrumentation
  pw-intel mcp                      Starts the Model Context Protocol (MCP) JSON-RPC server on stdio
  pw-intel generate <featureName>   Generates verified Page Object and Spec scaffolding
  pw-intel --help                   Shows this help message
`);
}

