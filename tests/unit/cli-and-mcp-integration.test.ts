import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { McpServer, JsonRpcRequest } from '../../src/mcp/server.js';
import { runCli } from '../../src/cli/index.js';

describe('CLI and MCP Server Integration Suite (20 Tests)', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-cli-mcp');
  let mcp: McpServer;

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    mcp = new McpServer();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- Category 1: MCP Server Protocol & Methods (15 tests) ---
  it('MCP-INIT-01: initialize request should return server capabilities and protocol version', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    };
    const res = await mcp.handleRequest(req);
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe('2024-11-05');
    expect(res.result.serverInfo.name).toBe('playwright-intelligence-mcp');
  });

  it('MCP-TOOLS-01: tools/list should return list of registered tools', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    };
    const res = await mcp.handleRequest(req);
    expect(res.result.tools).toBeDefined();
    expect(res.result.tools.length).toBeGreaterThanOrEqual(3);
  });

  it('MCP-TOOLS-02: tools/list should include diagnose_trace tool with schema', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 3, method: 'tools/list' };
    const res = await mcp.handleRequest(req);
    const tool = res.result.tools.find((t: any) => t.name === 'diagnose_trace');
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toContain('tracePath');
  });

  it('MCP-TOOLS-03: tools/list should include repair_page_object tool with schema', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 4, method: 'tools/list' };
    const res = await mcp.handleRequest(req);
    const tool = res.result.tools.find((t: any) => t.name === 'repair_page_object');
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toContain('pomPath');
    expect(tool.inputSchema.required).toContain('className');
  });

  it('MCP-TOOLS-04: tools/list should include generate_playwright_test tool with schema', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 5, method: 'tools/list' };
    const res = await mcp.handleRequest(req);
    const tool = res.result.tools.find((t: any) => t.name === 'generate_playwright_test');
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toContain('featureName');
  });

  it('MCP-CALL-01: generate_playwright_test should generate POM and spec code', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'generate_playwright_test',
        arguments: {
          featureName: 'UserAccount',
          steps: [{ action: 'click', role: 'button', name: 'Save' }],
        },
      },
    };
    const res = await mcp.handleRequest(req);
    expect(res.result.content[0].text).toContain('export class UserAccountPage');
    expect(res.result.content[0].text).toContain("this.page.getByRole('button', { name: 'Save' })");
  });

  it('MCP-CALL-02: generate_playwright_test missing arguments should return error response', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'generate_playwright_test',
        arguments: {}, // Missing featureName and steps
      },
    };
    const res = await mcp.handleRequest(req);
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32000);
  });

  it('MCP-CALL-03: diagnose_trace should analyze trace.zip archive', async () => {
    const zipPath = path.resolve(tmpDir, 'sample-trace.zip');
    const zip = new AdmZip();
    zip.addFile(
      '0-trace.trace',
      Buffer.from(
        '{"type":"version","version":10}\n' +
          JSON.stringify({
            type: 'before',
            callId: 'c1',
            apiName: 'page.click',
            params: { selector: '#bad' },
          }) +
          '\n' +
          JSON.stringify({ type: 'after', callId: 'c1', error: { message: 'Timeout' } })
      )
    );
    zip.writeZip(zipPath);

    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'diagnose_trace',
        arguments: { tracePath: zipPath },
      },
    };
    const res = await mcp.handleRequest(req);
    expect(res.result.content[0].text).toContain('DIAGNOSTIC REPORT');
    expect(res.result.classification).toBeDefined();
  });

  it('MCP-CALL-04: diagnose_trace with non-existent file should return error code -32000', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'diagnose_trace',
        arguments: { tracePath: path.resolve(tmpDir, 'missing.zip') },
      },
    };
    const res = await mcp.handleRequest(req);
    expect(res.error?.code).toBe(-32000);
  });

  it('MCP-CALL-05: repair_page_object should require approval token before modifying disk', async () => {
    const pomPath = path.resolve(tmpDir, 'TestPom.ts');
    const specPath = path.resolve(tmpDir, 'TestSpec.ts');

    await fs.writeFile(
      pomPath,
      `export class TestPom { readonly btn = this.page.locator('#old'); }`
    );
    await fs.writeFile(
      specPath,
      `test('spec', async ({ page }) => { await expect(page).toBeDefined(); });`
    );

    // Stage 1: Proposal request without approval token (Zero disk modification)
    const propReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'repair_page_object',
        arguments: {
          pomPath,
          testPath: specPath,
          className: 'TestPom',
          memberName: 'btn',
          replacementSelector: "this.page.getByRole('button', { name: 'New' })",
        },
      },
    };
    const propRes = await mcp.handleRequest(propReq);
    expect(propRes.result.status).toBe('PROPOSAL_READY_FOR_APPROVAL');
    expect(propRes.result.approvalToken).toBeDefined();

    // Verify file remains completely untouched prior to approval
    const prePom = await fs.readFile(pomPath, 'utf8');
    expect(prePom).toContain("this.page.locator('#old')");

    // Stage 2: Authorized application with verified approval token
    const applyReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'repair_page_object',
        arguments: {
          pomPath,
          testPath: specPath,
          className: 'TestPom',
          memberName: 'btn',
          replacementSelector: "this.page.getByRole('button', { name: 'New' })",
          approvalToken: propRes.result.approvalToken,
        },
      },
    };
    const applyRes = await mcp.handleRequest(applyReq);
    expect(applyRes.result.content[0].text).toContain('Successfully applied authorized repair');
    const patchedPom = await fs.readFile(pomPath, 'utf8');
    expect(patchedPom).toContain("this.page.getByRole('button', { name: 'New' })");
  });

  it('MCP-CALL-06: calling unknown tool should return error code -32602', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'non_existent_tool',
        arguments: {},
      },
    };
    const res = await mcp.handleRequest(req);
    expect(res.error?.code).toBe(-32602);
  });

  it('MCP-ERR-01: calling unknown JSON-RPC method should return error code -32601', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 12,
      method: 'unsupported/method',
    };
    const res = await mcp.handleRequest(req);
    expect(res.error?.code).toBe(-32601);
  });

  it('MCP-PROTO-01: string id in request must be preserved in response', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'req-alpha-123',
      method: 'initialize',
    };
    const res = await mcp.handleRequest(req);
    expect(res.id).toBe('req-alpha-123');
  });

  it('MCP-PROTO-02: numeric id 0 in request must be preserved in response', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
    };
    const res = await mcp.handleRequest(req);
    expect(res.id).toBe(0);
  });

  it('MCP-PROTO-03: tools/list should have empty params compatibility', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/list',
      params: {},
    };
    const res = await mcp.handleRequest(req);
    expect(res.result.tools).toBeDefined();
  });

  // --- Category 2: CLI Interface (5 tests) ---
  it('CLI-01: --version should output version number without error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'pw-intel', '--version']);
    expect(logSpy).toHaveBeenCalledWith('0.1.0');
    logSpy.mockRestore();
  });

  it('CLI-02: -v should output version number', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'pw-intel', '-v']);
    expect(logSpy).toHaveBeenCalledWith('0.1.0');
    logSpy.mockRestore();
  });

  it('CLI-03: --help should output usage documentation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'pw-intel', '--help']);
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0]![0];
    expect(output).toContain('Usage:');
    expect(output).toContain('pw-intel diagnose');
    logSpy.mockRestore();
  });

  it('CLI-04: no arguments should trigger printHelp without crashing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'pw-intel']);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('CLI-05: generate command should print generated POM and spec scaffolding', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'pw-intel', 'generate', 'UserProfile']);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
