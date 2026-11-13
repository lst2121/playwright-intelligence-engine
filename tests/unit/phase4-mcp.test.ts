import { describe, it, expect } from 'vitest';
import { McpServer, JsonRpcRequest } from '../../src/mcp/server.js';
import { PACKAGE_VERSION } from '../../src/core/version.js';
import { buildCiEvidenceReport } from '../../src/integrations/playwright-report-adapter.js';

describe('Phase 4 Model Context Protocol (MCP) Server Tests', () => {
  it('should respond to MCP initialize request with capabilities and server info', async () => {
    const server = new McpServer();
    const initReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    };

    const res = await server.handleRequest(initReq);
    expect(res.id).toBe(1);
    expect(res.result.serverInfo.name).toBe('playwright-intelligence-mcp');
    expect(res.result.capabilities.tools).toBeDefined();
  });

  it('should list all registered MCP tools with JSON schemas', async () => {
    const server = new McpServer();
    const listReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    };

    const res = await server.handleRequest(listReq);
    expect(res.id).toBe(2);
    expect(res.result.tools.length).toBeGreaterThanOrEqual(9);

    const toolNames = res.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('diagnose_trace');
    expect(toolNames).toContain('repair_page_object');
    expect(toolNames).toContain('generate_playwright_test');
    expect(toolNames).toContain('get_product_status');
    expect(toolNames).toContain('profile_repository');
    expect(toolNames).toContain('cluster_failures');
    expect(toolNames).toContain('suite_health');
    expect(toolNames).toContain('compile_repair_operation');
    expect(toolNames).toContain('propose_repair');
    expect(toolNames).toContain('analyze_repository_impact');
  });

  it('should handle tool call generate_playwright_test via MCP protocol', async () => {
    const server = new McpServer();
    const callReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'generate_playwright_test',
        arguments: {
          featureName: 'Checkout',
          baseUrl: 'https://automationexercise.com',
          steps: [
            { action: 'click', role: 'button', name: 'Proceed To Checkout' },
            { action: 'assert-visible', role: 'heading', name: 'Address Details' },
          ],
        },
      },
    };

    const res = await server.handleRequest(callReq);
    expect(res.id).toBe(3);
    expect(res.result.content[0].text).toContain('CheckoutPage');
    expect(res.result.content[0].text).toContain("this.page.getByRole('button', { name: 'Proceed To Checkout' })");
  });

  it('should expose verified product status through MCP', async () => {
    const server = new McpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_product_status', arguments: {} },
    });

    expect(res.result.packageVersion).toBe(PACKAGE_VERSION);
    expect(res.result.safetyMode).toBe('fail-closed');
    expect(res.result.capabilities.builtInLlmProvider).toBe(false);
  });

  it('should expose deterministic suite intelligence through MCP', async () => {
    const server = new McpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'suite_health',
        arguments: {
          runs: [
            { runId: '1', testId: 'login', status: 'PASS', timestamp: 1 },
            { runId: '2', testId: 'login', status: 'FAIL', timestamp: 2 },
          ],
        },
      },
    });
    expect(res.result.flakyTestCount).toBe(1);
  });

  it('should compile safe repair proposals without mutating files through MCP', async () => {
    const server = new McpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'compile_repair_operation',
        arguments: {
          operation: {
            kind: 'add_frame_scope',
            target: "this.page.getByRole('button', { name: 'Pay' })",
            frameLocator: 'iframe[title="Payment"]',
          },
        },
      },
    });
    expect(res.result.readiness).toBe('READY_FOR_ISOLATED_VERIFICATION');
    expect(res.result.replacementLocator).toContain('frameLocator');
  });

  it('should expose the team dashboard aggregation through MCP', async () => {
    const server = new McpServer();
    const evidence = buildCiEvidenceReport({ suites: [] }, { repository: 'shop', runId: 'run-1' });
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'build_team_dashboard',
        arguments: { runs: [{ runId: 'run-1', repository: 'shop', evidence }] },
      },
    });
    expect(res.result.repositoryCount).toBe(1);
    expect(res.result.repositories[0].repository).toBe('shop');
    expect(res.result.markdown).toContain('PIE Team Quality Dashboard');
  });
});

