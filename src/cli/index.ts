import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { McpServer } from '../mcp/server.js';
import { TestGenerator } from '../generator/test-generator.js';

export async function runCli(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
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
      let traceText = '';
      let networkText = '';

      try {
        traceText = await ArchiveReader.readEntryAsText(tracePath, 'trace.trace');
      } catch {
        traceText = await ArchiveReader.readEntryAsText(tracePath, '0.trace');
      }

      try {
        networkText = await ArchiveReader.readEntryAsText(tracePath, 'trace.network');
      } catch {
        try {
          networkText = await ArchiveReader.readEntryAsText(tracePath, '0.network');
        } catch {
          networkText = '';
        }
      }

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
  pw-intel mcp                      Starts the Model Context Protocol (MCP) JSON-RPC server on stdio
  pw-intel generate <featureName>   Generates verified Page Object and Spec scaffolding
  pw-intel --help                   Shows this help message
`);
}
