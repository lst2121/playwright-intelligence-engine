import readline from 'node:readline';
import { ArchiveReader } from '../trace/archive-reader.js';
import { TraceParser } from '../trace/trace-parser.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { AstPatcher } from '../repair/ast-patcher.js';
import { AssertionHasher } from '../repair/assertion-hasher.js';
import { TestGenerator } from '../generator/test-generator.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpServer {
  private readonly rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  }

  public start(): void {
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req: JsonRpcRequest = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        process.stdout.write(JSON.stringify(res) + '\n');
      } catch (err: any) {
        const errRes: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32700, message: `Parse error: ${err.message}` },
        };
        process.stdout.write(JSON.stringify(errRes) + '\n');
      }
    });
  }

  public async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'playwright-intelligence-mcp',
              version: '0.1.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            tools: [
              {
                name: 'diagnose_trace',
                description: 'Analyzes a Playwright trace.zip archive and outputs root-cause classification (LOCATOR_DRIFT, AUTH_EXPIRED, BACKEND_500) with abstention guidance.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    tracePath: { type: 'string', description: 'Absolute or relative path to trace.zip archive' },
                  },
                  required: ['tracePath'],
                },
              },
              {
                name: 'repair_page_object',
                description: 'Safely refactors a Playwright Page Object file using ts-morph AST while validating assertion immutability.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    pomPath: { type: 'string', description: 'Path to Page Object file' },
                    testPath: { type: 'string', description: 'Path to test spec file' },
                    className: { type: 'string', description: 'Page Object class name' },
                    memberName: { type: 'string', description: 'Target locator member name' },
                    replacementSelector: { type: 'string', description: 'Replacement locator expression' },
                  },
                  required: ['pomPath', 'testPath', 'className', 'memberName', 'replacementSelector'],
                },
              },
              {
                name: 'generate_playwright_test',
                description: 'Generates enterprise-grade TypeScript Playwright Page Object and spec code with web-first assertions.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    featureName: { type: 'string', description: 'Name of the feature/page' },
                    baseUrl: { type: 'string', description: 'Target application URL' },
                    steps: { type: 'array', description: 'Array of interaction steps' },
                  },
                  required: ['featureName', 'steps'],
                },
              },
            ],
          },
        };

      case 'tools/call':
        return this.handleToolCall(req.id, req.params?.name, req.params?.arguments);

      default:
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method '${req.method}' not found` },
        };
    }
  }

  private async handleToolCall(id: number | string, toolName: string, args: any): Promise<JsonRpcResponse> {
    try {
      if (toolName === 'diagnose_trace') {
        const tracePath = args?.tracePath;
        if (!tracePath) throw new Error('tracePath is required');

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

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: report }],
            classification: correlated.classification,
          },
        };
      }

      if (toolName === 'repair_page_object') {
        const { pomPath, testPath, className, memberName, replacementSelector } = args;
        const initialFingerprint = AssertionHasher.computeFingerprint(testPath);

        const patcher = new AstPatcher();
        const patchResult = patcher.patchPageObject({
          filePath: pomPath,
          className,
          memberName,
          replacementExpression: replacementSelector,
        });

        const postFingerprint = AssertionHasher.computeFingerprint(testPath);
        const assertionIntact = initialFingerprint === postFingerprint;

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Successfully patched ${className}.${memberName} via ${patchResult.pattern}.\nAssertion AST SHA-256 fingerprint verified intact: ${assertionIntact}`,
              },
            ],
            patchResult,
            assertionIntact,
          },
        };
      }

      if (toolName === 'generate_playwright_test') {
        const { featureName, baseUrl, steps } = args;
        const generated = TestGenerator.generateSuite(featureName, steps, baseUrl);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `// Page Object: ${generated.pageObjectName}.ts\n${generated.pageObjectCode}\n\n// Test Spec\n${generated.specCode}`,
              },
            ],
            generated,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool '${toolName}'` },
      };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message },
      };
    }
  }
}
