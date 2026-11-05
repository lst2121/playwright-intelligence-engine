import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { ArchiveReader } from '../trace/archive-reader.js';
import { VersionDetector } from '../trace/version-detector.js';
import { TraceAdapterRegistry } from '../trace/adapters/adapter-registry.js';
import { EvidenceCorrelator } from '../diagnostics/evidence-correlator.js';
import { DiagnosticReportGenerator } from '../diagnostics/diagnostic-report.js';
import { AstPatcher } from '../repair/ast-patcher.js';
import { AssertionHasher } from '../repair/assertion-hasher.js';
import { DiffAllowlistValidator } from '../repair/diff-allowlist.js';
import { ApprovalService } from '../repair/approval-service.js';
import { WorkspacePromoter } from '../repair/workspace-promoter.js';
import { TestGenerator } from '../generator/test-generator.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null | undefined;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpServer {
  private readonly rl: readline.Interface;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  }

  /**
   * Asserts that a file path resolves within the authorized workspace boundary.
   * Uses canonical filesystem resolution (fs.realpathSync) to prevent symlink,
   * junction, or reparse point bypasses outside the workspace boundary (AUDIT-05).
   * Unconditionally fails closed if canonical realpath resolution fails.
   */
  public assertPathInWorkspace(targetPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, targetPath);

    if (!fs.existsSync(this.workspaceRoot)) {
      throw new Error(`Workspace root does not exist: '${this.workspaceRoot}'`);
    }

    const canonicalWorkspace = fs.realpathSync(this.workspaceRoot);
    let canonicalTarget: string;

    if (fs.existsSync(resolved)) {
      canonicalTarget = fs.realpathSync(resolved);
    } else {
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        canonicalTarget = path.join(fs.realpathSync(parent), path.basename(resolved));
      } else {
        throw new Error(
          `Workspace Security Violation: Path '${targetPath}' cannot be resolved inside authorized workspace boundary '${canonicalWorkspace}'.`
        );
      }
    }

    const rel = path.relative(canonicalWorkspace, canonicalTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `Workspace Security Violation: Path '${targetPath}' resolves to '${canonicalTarget}' outside authorized workspace boundary '${canonicalWorkspace}'.`
      );
    }

    return canonicalTarget;
  }

  public start(): void {
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let req: any;
      try {
        req = JSON.parse(trimmed);
      } catch (err: any) {
        // Spec compliance: Parse error returns id: null
        const errRes: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` },
        };
        process.stdout.write(JSON.stringify(errRes) + '\n');
        return;
      }

      const res = await this.handleRequest(req);
      process.stdout.write(JSON.stringify(res) + '\n');
    });
  }

  public async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id ?? null;

    if (req.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      };
    }

    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'playwright-intelligence-mcp',
              version: '2.6.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'diagnose_trace',
                description: 'Analyzes a Playwright trace.zip archive and outputs root-cause classification with causal evidence.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    tracePath: { type: 'string', description: 'Workspace-relative or absolute path to trace.zip archive' },
                  },
                  required: ['tracePath'],
                },
              },
              {
                name: 'repair_page_object',
                description: 'Safely refactors a Playwright Page Object file using ts-morph AST within authorized workspace, with strict locator grammar and assertion immutability validation.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    pomPath: { type: 'string', description: 'Path to Page Object file within workspace' },
                    testPath: { type: 'string', description: 'Path to test spec file within workspace' },
                    className: { type: 'string', description: 'Page Object class name' },
                    memberName: { type: 'string', description: 'Target locator member name' },
                    replacementSelector: { type: 'string', description: 'Replacement locator expression' },
                    approvalToken: { type: 'string', description: 'Cryptographic single-use approval token required to apply changes to workspace' },
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
        return this.handleToolCall(id, req.params?.name, req.params?.arguments);

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method '${req.method}' not found` },
        };
    }
  }

  private async handleToolCall(id: number | string | null, toolName: string, args: any): Promise<JsonRpcResponse> {
    try {
      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name' },
        };
      }

      if (toolName === 'diagnose_trace') {
        const tracePathRaw = args?.tracePath;
        if (!tracePathRaw || typeof tracePathRaw !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: 'tracePath argument must be a non-empty string' },
          };
        }

        const tracePath = this.assertPathInWorkspace(tracePathRaw);
        if (!fs.existsSync(tracePath)) {
          throw new Error(`Trace file not found: '${tracePath}'`);
        }

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
        const versionInfo = VersionDetector.detectFromLines(traceLines);
        const adapter = TraceAdapterRegistry.getAdapter(versionInfo.traceFormatVersion);
        const manifest = {
          archivePath: tracePath,
          entryNames: [traceEntryName, networkEntryName].filter(Boolean) as string[],
          traceEntryName,
          networkEntryName,
        };
        const context = await adapter.parse(manifest, traceLines, networkLines);
        const correlated = EvidenceCorrelator.correlate(context);
        const report = DiagnosticReportGenerator.generateTerminalReport(correlated);

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: report }],
            classification: correlated.classification,
            causalGraph: correlated.classification.causalGraph,
          },
        };
      }

      if (toolName === 'repair_page_object') {
        const { pomPath: pomRaw, testPath: testRaw, className, memberName, replacementSelector, approvalToken } = args ?? {};
        if (!pomRaw || !testRaw || !className || !memberName || !replacementSelector) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: 'Missing required arguments: pomPath, testPath, className, memberName, replacementSelector',
            },
          };
        }

        const pomPath = this.assertPathInWorkspace(pomRaw);
        const testPath = this.assertPathInWorkspace(testRaw);

        if (!fs.existsSync(pomPath)) throw new Error(`Page Object file not found: '${pomPath}'`);
        if (!fs.existsSync(testPath)) throw new Error(`Test spec file not found: '${testPath}'`);

        // Validate locator expression grammar upfront recursively
        const grammar = DiffAllowlistValidator.validateLocatorGrammar(replacementSelector);
        if (!grammar.isValid) {
          throw new Error(`Security Violation: Disallowed replacement expression '${replacementSelector}'. ${grammar.reason}`);
        }

        const origPomSource = await fs.promises.readFile(pomPath, 'utf-8');
        const origTestSource = await fs.promises.readFile(testPath, 'utf-8');
        const initialFingerprint = AssertionHasher.computeFingerprint(testPath);

        // Pre-validate diff allowlist in-memory before writing to disk
        const patcher = new AstPatcher();
        const inMemPatch = patcher.patchPageObjectInMemory(origPomSource, {
          className,
          memberName,
          replacementExpression: replacementSelector,
        });

        const diffValidation = DiffAllowlistValidator.validate({
          originalSource: origPomSource,
          patchedSource: inMemPatch.patchedSource,
          targetClassName: className,
          targetMemberName: memberName,
        });

        if (!diffValidation.isAllowed) {
          throw new Error(`Diff Allowlist Rejected: ${diffValidation.reason}`);
        }

        const fullDiff = inMemPatch.diff ?? '';

        // If an approvalToken is provided, promote atomically via WorkspacePromoter under lock
        if (approvalToken) {
          const tokenPayload = ApprovalService.getInstance().getTokenPayload(approvalToken);
          if (!tokenPayload) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `Repair Authorization Denied: Approval token '${approvalToken}' not found or already consumed/expired.`,
              },
            };
          }

          // Promote verified patch atomically via WorkspacePromoter (which validates CAS and consumes token under lock)
          const promoResult = await WorkspacePromoter.promote({
            targetFilePath: pomPath,
            workspaceRoot: this.workspaceRoot,
            patchedContent: inMemPatch.patchedSource,
            approvalTokenPayload: tokenPayload,
          });

          if (!promoResult.success) {
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `Workspace Promotion Failed: ${promoResult.error}`,
              },
            };
          }

          const postFingerprint = AssertionHasher.computeFingerprint(testPath);
          const assertionIntact = initialFingerprint === postFingerprint;

          if (!assertionIntact) {
            // Rollback immediately if assertion fingerprint altered
            await fs.promises.writeFile(pomPath, origPomSource, 'utf8');
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: 'Safety Invariant Violation: Assertion AST SHA-256 fingerprint altered by repair. Mutation rolled back.',
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Successfully applied authorized repair to ${className}.${memberName} via atomic WorkspacePromoter.\nAssertion AST fingerprint verified intact: ${assertionIntact}`,
                },
              ],
              status: 'APPLIED',
              patchResult: {
                filePath: pomPath,
                className,
                memberName,
                pattern: inMemPatch.pattern,
                originalSelector: '',
                replacementSelector,
                success: true,
              },
              assertionIntact: true,
            },
          };
        }

        // When approvalToken is omitted: stage proposal ONLY as a draft. Never leak usable bearer token or fabricate execution verification.
        const staged = ApprovalService.getInstance().stageProposal({
          targetFilePath: pomPath,
          targetClassName: className,
          targetMemberName: memberName,
          originalSourceContent: origPomSource,
          replacementSelector,
          fullDiff,
          patchedSource: inMemPatch.patchedSource,
          testFilePath: testPath,
          testFileContent: origTestSource,
          worktreeId: 'staged-draft',
        });

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Repair proposal staged in-memory. Isolated AST diff validated.\nProposal ID: ${staged.proposalId}\nPattern: ${inMemPatch.pattern}\n\nTo review and authorize promotion, a human operator must run:\n  pw-intel approve ${staged.proposalId}`,
              },
            ],
            status: 'PROPOSAL_READY_FOR_APPROVAL',
            proposalId: staged.proposalId,
            pattern: inMemPatch.pattern,
            diff: inMemPatch.diff,
            target: { className, memberName, replacementSelector },
          },
        };
      }

      if (toolName === 'generate_playwright_test') {
        const { featureName, baseUrl, steps } = args ?? {};
        if (!featureName || !Array.isArray(steps)) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: 'Missing required arguments: featureName (string) and steps (array)' },
          };
        }

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
