import { describe, it, expect } from 'vitest';
import { McpServer, JsonRpcRequest } from '../../src/mcp/server.js';

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
    expect(res.result.tools).toHaveLength(3);

    const toolNames = res.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('diagnose_trace');
    expect(toolNames).toContain('repair_page_object');
    expect(toolNames).toContain('generate_playwright_test');
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
});
