import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '..', 'bin', 'pw-intel.js');

async function runMcpTest() {
  console.log('[MCP Test] Spawning pw-intel mcp process...');
  const proc = spawn('node', [cliPath, 'mcp'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let buffer = '';
  const pendingRequests = new Map();

  proc.stdout.on('data', (data) => {
    buffer += data.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const resolver = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          resolver(msg);
        }
      } catch (err) {
        console.error('Failed to parse stdout line:', line, err);
      }
    }
  });

  let requestId = 1;
  function sendRpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = requestId++;
      pendingRequests.set(id, resolve);
      const req = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  try {
    // 1. Initialize
    console.log('[MCP Test] 1. Calling initialize...');
    const initRes = await sendRpc('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    console.log('[MCP Test] initialize response:', JSON.stringify(initRes.result.serverInfo));

    // 2. tools/list
    console.log('[MCP Test] 2. Calling tools/list...');
    const toolsRes = await sendRpc('tools/list');
    const toolNames = toolsRes.result.tools.map((t) => t.name);
    console.log(`[MCP Test] Received ${toolNames.length} tools`);

    // 3. tools/call pw_intel_stabilize_test
    console.log('[MCP Test] 3. Calling pw_intel_stabilize_test...');
    const stabilizeRes = await sendRpc('tools/call', {
      name: 'pw_intel_stabilize_test',
      arguments: {
        testFilePath: 'tests/fixtures/flaky-sample.spec.ts',
        execute: false,
      },
    });
    console.log('[MCP Test] pw_intel_stabilize_test result status:', stabilizeRes.result?.content?.[0]?.text?.slice(0, 100));

    // 4. Test security containment guard: blocks paths outside workspace boundary
    console.log('[MCP Test] 4. Testing workspace boundary security guard...');
    const forbiddenRes = await sendRpc('tools/call', {
      name: 'pw_intel_diagnose',
      arguments: {
        tracePath: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
      },
    });
    if (!forbiddenRes.error || !forbiddenRes.error.message.includes('Workspace Security Violation')) {
      throw new Error('Workspace security containment guard failed to trigger!');
    }
    console.log('[MCP Test] Security containment successfully enforced:', forbiddenRes.error.message);

    console.log('[MCP Test] ALL MCP CHECKS PASSED PERFECTLY!');
  } finally {
    proc.stdin.end();
    proc.kill();
  }
}

runMcpTest().catch((err) => {
  console.error('[MCP Test] ERROR:', err);
  process.exit(1);
});
