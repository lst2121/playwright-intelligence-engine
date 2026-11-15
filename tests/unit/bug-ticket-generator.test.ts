import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { BugTicketGenerator, generateReproductionCurl } from '../../src/integrations/bug-ticket-generator.js';
import { DiagnosticContext, NetworkEvent } from '../../src/core/types/diagnostic-context.js';

describe('BugTicketGenerator Unit & Invariant Tests (Track A)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pie-bug-ticket-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates an unedited curl reproduction command with sanitized auth tokens', () => {
    const event: NetworkEvent = {
      url: 'https://restful-booker.herokuapp.com/api/room',
      method: 'POST',
      status: 500,
      timestamp: 1000,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer super-secret-token-xyz',
        'cookie': 'sessionid=12345',
        'x-custom-tenant': 'tenant-99',
      },
    };

    const curl = generateReproductionCurl(event);
    expect(curl).toContain('curl -X POST "https://restful-booker.herokuapp.com/api/room"');
    expect(curl).toContain('-H "content-type: application/json"');
    expect(curl).toContain('-H "x-custom-tenant: tenant-99"');
    expect(curl).toContain('[REDACTED_AUTH_TOKEN]');
    expect(curl).not.toContain('super-secret-token-xyz');
  });

  it('generates ready-to-file GitHub markdown and Jira markup for backend 500 negative control', async () => {
    const context: DiagnosticContext = {
      playwrightVersion: '1.45.0',
      traceFormatVersion: 10,
      failedAction: {
        callId: 'call@action-1',
        action: 'page.click',
        selector: '#doLogin',
        sourceFile: 'tests/booking.spec.ts',
        line: 42,
        errorMessage: 'Timeout 30000ms exceeded waiting for locator("#doLogin")',
      },
      snapshots: {},
      networkEvents: [
        {
          url: 'https://restful-booker.herokuapp.com/api/room',
          method: 'POST',
          status: 500,
          statusText: 'Internal Server Error',
          durationMs: 142,
          timestamp: 5000,
          headers: { 'content-type': 'application/json' },
        },
      ],
      consoleEvents: [
        {
          type: 'error',
          text: 'Failed to load resource: the server responded with a status of 500',
          timestamp: 5002,
        },
      ],
      evidenceCompleteness: { domAvailable: true, networkAvailable: true, sourceAvailable: true },
    };

    const ticket = BugTicketGenerator.generate({
      context,
      tracePath: path.resolve(tmpDir, 'trace.zip'),
      workspaceRoot: tmpDir,
      testTitle: 'Create Booking Room Flow',
    });

    expect(ticket.ticketId).toMatch(/^DEFECT-\d{8}-[a-f0-9]{8}$/);
    expect(ticket.severity).toBe('CRITICAL');
    expect(ticket.category).toBe('BACKEND_500');
    expect(ticket.title).toContain('Backend HTTP 500 on POST /api/room');
    expect(ticket.reproductionCurl).toContain('curl -X POST "https://restful-booker.herokuapp.com/api/room"');
    expect(ticket.consoleErrors.length).toBe(1);

    // Markdown checks
    expect(ticket.markdown).toContain('# [Defect][CRITICAL] Backend HTTP 500 on POST /api/room');
    expect(ticket.markdown).toContain('Gate 0 Decision:** **STRICT ABSTENTION**');
    expect(ticket.markdown).toContain('curl -X POST');

    // Jira checks
    expect(ticket.jiraMarkup).toContain('h1. [Defect][CRITICAL]');
    expect(ticket.jiraMarkup).toContain('{code:bash}');

    // Disk persistence checks
    expect(ticket.savedPath).toBeDefined();
    const mdContent = await fs.readFile(ticket.savedPath!, 'utf8');
    expect(mdContent).toBe(ticket.markdown);

    const jsonPath = ticket.savedPath!.replace(/\.md$/, '.json');
    const jsonRaw = await fs.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(jsonRaw);
    expect(parsed.ticketId).toBe(ticket.ticketId);
    expect(parsed.severity).toBe('CRITICAL');
  });

  it('correctly classifies AUTH_EXPIRED with HIGH severity', () => {
    const context: DiagnosticContext = {
      playwrightVersion: '1.45.0',
      traceFormatVersion: 10,
      failedAction: {
        callId: 'call@2',
        action: 'page.click',
        selector: '#dashboard',
        sourceFile: 'tests/dashboard.spec.ts',
      },
      snapshots: {},
      networkEvents: [
        {
          url: 'https://app.test/api/user/session',
          method: 'GET',
          status: 401,
          statusText: 'Unauthorized',
          timestamp: 2000,
        },
      ],
      consoleEvents: [],
      evidenceCompleteness: { domAvailable: true, networkAvailable: true, sourceAvailable: true },
    };

    const ticket = BugTicketGenerator.generate({
      context,
      tracePath: path.resolve(tmpDir, 'trace.zip'),
      workspaceRoot: tmpDir,
      testTitle: 'Dashboard Access Test',
    });

    expect(ticket.category).toBe('AUTH_EXPIRED');
    expect(ticket.severity).toBe('HIGH');
    expect(ticket.title).toContain('HTTP 401');
    expect(ticket.justification).toContain('Negative Control Triggered (AUTH_EXPIRED)');
  });
});
