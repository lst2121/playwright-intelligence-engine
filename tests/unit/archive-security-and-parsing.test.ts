import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { ArchiveReader } from '../../src/trace/archive-reader.js';
import { ZipSlipSecurityError, TraceCorruptedError } from '../../src/core/errors/engine-errors.js';
import { TraceParser } from '../../src/trace/trace-parser.js';

describe('Archive Security and Trace Parsing Suite (45 Tests)', () => {
  const tmpDir = path.resolve('tests/fixtures/tmp-archive-security');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- Category 1: Zip-Slip and Path Traversal Security (15 tests) ---
  const pathTraversalVariants = [
    '../../etc/passwd',
    '..\\..\\windows\\system32\\calc.exe',
    'nested/../../../malicious.sh',
    '/root/secret.env',
    'C:\\Windows\\win.ini',
    'subfolder/../../traversal.txt',
    './../../etc/shadow',
    '..//..//escaped.bin',
    'dir/subdir/../../../../outside.txt',
    'a/b/c/../../../../payload.bat',
    '..\\..\\..\\payload.exe',
    'valid/dir/../../../etc/hosts',
    './..//./..//jailbreak.js',
    'target/../../rooted.json',
    'foo/bar/../../../../danger.txt',
  ];

  pathTraversalVariants.forEach((badPath, idx) => {
    it(`SEC-ZIPSLIP-${idx + 1}: should reject path traversal attempt: "${badPath}"`, async () => {
      const zipPath = path.resolve(tmpDir, `zipslip-${idx}.zip`);
      const extractDir = path.resolve(tmpDir, `extract-${idx}`);

      const zip = new AdmZip();
      zip.addFile('safe.txt', Buffer.from('safe content'));
      const maliciousEntry = zip.addFile('placeholder.txt', Buffer.from('malicious payload'));
      maliciousEntry.entryName = badPath;
      zip.writeZip(zipPath);

      await expect(ArchiveReader.unpackSafely(zipPath, extractDir)).rejects.toThrow(
        ZipSlipSecurityError
      );
    });
  });

  // --- Category 2: Zip Bomb, Size Limits and Entry Caps (10 tests) ---
  it('SEC-BOMB-01: should reject archive exceeding default 500 MB uncompressed limit', async () => {
    const zipPath = path.resolve(tmpDir, 'bomb-large.zip');
    const extractDir = path.resolve(tmpDir, 'extract-large');

    const zip = new AdmZip();
    const fakeHeader = Buffer.alloc(10);
    zip.addFile('huge.bin', fakeHeader);
    const entry = zip.getEntry('huge.bin')!;
    entry.header.size = 501 * 1024 * 1024; // 501 MB
    zip.writeZip(zipPath);

    await expect(ArchiveReader.unpackSafely(zipPath, extractDir)).rejects.toThrow(TraceCorruptedError);
    await expect(ArchiveReader.unpackSafely(zipPath, extractDir)).rejects.toThrow(/Zip-Bomb suspected/);
  });

  it('SEC-BOMB-02: should reject archive exceeding custom total size limit of 10 MB', async () => {
    const zipPath = path.resolve(tmpDir, 'bomb-custom.zip');
    const extractDir = path.resolve(tmpDir, 'extract-custom');

    const zip = new AdmZip();
    zip.addFile('blob.bin', Buffer.alloc(10));
    zip.getEntry('blob.bin')!.header.size = 11 * 1024 * 1024;
    zip.writeZip(zipPath);

    await expect(
      ArchiveReader.unpackSafely(zipPath, extractDir, { maxTotalSize: 10 * 1024 * 1024 })
    ).rejects.toThrow(/Zip-Bomb suspected/);
  });

  it('SEC-BOMB-03: should reject archive exceeding maximum entry count cap (10 entries custom)', async () => {
    const zipPath = path.resolve(tmpDir, 'bomb-entries.zip');
    const extractDir = path.resolve(tmpDir, 'extract-entries');

    const zip = new AdmZip();
    for (let i = 0; i < 15; i++) {
      zip.addFile(`entry-${i}.txt`, Buffer.from(`file ${i}`));
    }
    zip.writeZip(zipPath);

    await expect(
      ArchiveReader.unpackSafely(zipPath, extractDir, { maxEntries: 10 })
    ).rejects.toThrow(/Zip-Bomb suspected: archive contains 15 entries/);
  });

  it('SEC-BOMB-04: should reject corrupt or unparseable zip binary', async () => {
    const corruptPath = path.resolve(tmpDir, 'corrupt.zip');
    await fs.writeFile(corruptPath, Buffer.from('NOT_A_VALID_ZIP_HEADER_123456'));

    await expect(ArchiveReader.unpackSafely(corruptPath, path.resolve(tmpDir, 'out'))).rejects.toThrow(
      TraceCorruptedError
    );
  });

  it('SEC-BOMB-05: should reject non-existent archive path', async () => {
    const missing = path.resolve(tmpDir, 'non-existent.zip');
    await expect(ArchiveReader.unpackSafely(missing, path.resolve(tmpDir, 'out'))).rejects.toThrow(
      TraceCorruptedError
    );
  });

  it('SEC-BOMB-06: should unpack legitimate archive within safety thresholds', async () => {
    const validZip = path.resolve(tmpDir, 'valid.zip');
    const outDir = path.resolve(tmpDir, 'valid-out');

    const zip = new AdmZip();
    zip.addFile('trace.trace', Buffer.from('{"type":"version","version":10}\n'));
    zip.addFile('trace.network', Buffer.from(''));
    zip.writeZip(validZip);

    const result = await ArchiveReader.unpackSafely(validZip, outDir);
    expect(result.hasTraceEventFile).toBe(true);
    expect(result.hasNetworkEventFile).toBe(true);
    expect(result.entryNames).toContain('trace.trace');
  });

  it('SEC-BOMB-07: should support memory-only entry extraction via readEntryAsText', async () => {
    const validZip = path.resolve(tmpDir, 'read-mem.zip');
    const zip = new AdmZip();
    zip.addFile('config.json', Buffer.from('{"status":"ok"}'));
    zip.writeZip(validZip);

    const content = await ArchiveReader.readEntryAsText(validZip, 'config.json');
    expect(JSON.parse(content)).toEqual({ status: 'ok' });
  });

  it('SEC-BOMB-08: should throw error when reading non-existent entry in archive', async () => {
    const validZip = path.resolve(tmpDir, 'read-missing.zip');
    const zip = new AdmZip();
    zip.addFile('data.txt', Buffer.from('hello'));
    zip.writeZip(validZip);

    await expect(ArchiveReader.readEntryAsText(validZip, 'missing.txt')).rejects.toThrow(
      TraceCorruptedError
    );
  });

  it('SEC-BOMB-09: should discover trace files with modern naming (1-trace.trace)', async () => {
    const zipPath = path.resolve(tmpDir, 'modern-naming.zip');
    const zip = new AdmZip();
    zip.addFile('1-trace.trace', Buffer.from('action-data'));
    zip.addFile('1-trace.network', Buffer.from('network-data'));
    zip.writeZip(zipPath);

    const discovered = ArchiveReader.findTraceFileEntries(zipPath);
    expect(discovered.traceEntryName).toBe('1-trace.trace');
    expect(discovered.networkEntryName).toBe('1-trace.network');
  });

  it('SEC-BOMB-10: should discover trace files with legacy naming (0.trace)', async () => {
    const zipPath = path.resolve(tmpDir, 'legacy-naming.zip');
    const zip = new AdmZip();
    zip.addFile('0.trace', Buffer.from('action-data-legacy'));
    zip.addFile('0.network', Buffer.from('network-data-legacy'));
    zip.writeZip(zipPath);

    const discovered = ArchiveReader.findTraceFileEntries(zipPath);
    expect(discovered.traceEntryName).toBe('0.trace');
    expect(discovered.networkEntryName).toBe('0.network');
  });

  // --- Category 3: Trace JSONL Stream Parsing and Resilience (20 tests) ---
  it('PARSE-01: should parse empty lines gracefully without throwing', () => {
    const lines = ['', '   ', '\n', '\r\n'];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.size).toBe(0);
    expect(result.failedAction).toBeUndefined();
  });

  it('PARSE-02: should skip corrupted non-JSON lines and parse valid subsequent lines', () => {
    const lines = [
      'MALFORMED_NON_JSON_LINE',
      '{"type":"before","callId":"c1","apiName":"page.click","params":{"selector":"#btn"}}',
      'ANOTHER_CORRUPT_TOKEN',
      '{"type":"after","callId":"c1"}',
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.size).toBe(1);
    expect(result.actions.get('c1')?.action).toBe('page.click');
  });

  it('PARSE-03: should match callId across separated before and after events', () => {
    const lines = [
      JSON.stringify({ type: 'before', callId: 'call@100', apiName: 'page.fill', params: { selector: '#user' } }),
      JSON.stringify({ type: 'event', method: 'console', params: { text: 'filling input' } }),
      JSON.stringify({ type: 'after', callId: 'call@100' }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    const action = result.actions.get('call@100');
    expect(action?.action).toBe('page.fill');
    expect(action?.selector).toBe('#user');
  });

  it('PARSE-04: should capture durationMs when timestamps are available', () => {
    const lines = [
      JSON.stringify({ type: 'before', callId: 'c2', apiName: 'page.click', wallTime: 1000 }),
      JSON.stringify({ type: 'after', callId: 'c2', endTime: 1250 }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.get('c2')?.durationMs).toBe(250);
  });

  it('PARSE-05: should parse error stack and message on failed action', () => {
    const lines = [
      JSON.stringify({ type: 'before', callId: 'c3', apiName: 'page.click', params: { selector: '#bad' } }),
      JSON.stringify({
        type: 'after',
        callId: 'c3',
        error: { message: 'Timeout 5000ms exceeded', stack: 'Error at spec.ts:42' },
      }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.failedAction?.callId).toBe('c3');
    expect(result.failedAction?.errorMessage).toBe('Timeout 5000ms exceeded');
    expect(result.failedAction?.errorStack).toBe('Error at spec.ts:42');
  });

  it('PARSE-06: should extract source file, line and column from action stack frames', () => {
    const lines = [
      JSON.stringify({
        type: 'before',
        callId: 'c4',
        apiName: 'page.click',
        stack: [{ file: 'tests/checkout.spec.ts', line: 15, column: 7 }],
      }),
      JSON.stringify({ type: 'after', callId: 'c4' }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.get('c4')?.sourceFile).toBe('tests/checkout.spec.ts');
    expect(result.actions.get('c4')?.line).toBe(15);
    expect(result.actions.get('c4')?.column).toBe(7);
  });

  it('PARSE-07: should capture console log events with timestamps', () => {
    const lines = [
      JSON.stringify({
        type: 'event',
        method: 'console',
        params: { type: 'log', text: 'App initialized' },
        wallTime: 2000,
      }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.consoleEvents.length).toBe(1);
    expect(result.consoleEvents[0]?.text).toBe('App initialized');
    expect(result.consoleEvents[0]?.timestamp).toBe(2000);
  });

  it('PARSE-08: should capture pageError uncaught exceptions as error console events', () => {
    const lines = [
      JSON.stringify({
        type: 'event',
        method: 'pageError',
        params: { text: 'Uncaught TypeError: Cannot read null' },
        wallTime: 3000,
      }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.consoleEvents[0]?.type).toBe('error');
    expect(result.consoleEvents[0]?.text).toContain('Uncaught TypeError');
  });

  it('PARSE-09: should parse resource-snapshot network events', () => {
    const networkLines = [
      JSON.stringify({
        type: 'resource-snapshot',
        snapshot: {
          request: { url: 'https://api.example.com/v1/auth', method: 'POST' },
          response: { status: 200, statusText: 'OK' },
          wallTime: 4000,
          time: 120,
        },
      }),
    ];
    const events = TraceParser.parseNetworkLines(networkLines);
    expect(events.length).toBe(1);
    expect(events[0]?.url).toBe('https://api.example.com/v1/auth');
    expect(events[0]?.status).toBe(200);
    expect(events[0]?.durationMs).toBe(120);
  });

  it('PARSE-10: should parse direct response network events', () => {
    const networkLines = [
      JSON.stringify({
        type: 'response',
        url: 'https://api.example.com/v1/data',
        method: 'GET',
        status: 404,
        statusText: 'Not Found',
        wallTime: 5000,
      }),
    ];
    const events = TraceParser.parseNetworkLines(networkLines);
    expect(events[0]?.status).toBe(404);
  });

  it('PARSE-11: should handle network events with missing status or url gracefully', () => {
    const networkLines = [
      JSON.stringify({ type: 'response' }),
      JSON.stringify({ type: 'resource-snapshot', snapshot: {} }),
    ];
    const events = TraceParser.parseNetworkLines(networkLines);
    expect(events.length).toBe(1);
    expect(events[0]?.url).toBe('unknown');
    expect(events[0]?.status).toBe(0);
  });

  it('PARSE-12: should assemble normalized DiagnosticContext from streams', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'c5', apiName: 'page.click', params: { selector: '#btn' } }),
      JSON.stringify({ type: 'after', callId: 'c5', error: { message: 'Timeout' } }),
    ];
    const networkLines = [
      JSON.stringify({ type: 'response', url: 'https://api.test/ping', status: 200 }),
    ];

    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    expect(context.traceFormatVersion).toBe(10);
    expect(context.failedAction.callId).toBe('c5');
    expect(context.networkEvents.length).toBe(1);
  });

  it('PARSE-13: should handle empty network lines and return empty networkEvents array', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 9 }),
      JSON.stringify({ type: 'before', callId: 'c6', apiName: 'page.waitForSelector' }),
    ];
    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.networkEvents).toEqual([]);
    expect(context.evidenceCompleteness.networkAvailable).toBe(false);
  });

  it('PARSE-14: should correctly identify multiple actions and select first failed action', () => {
    const lines = [
      JSON.stringify({ type: 'before', callId: 'c7', apiName: 'page.goto' }),
      JSON.stringify({ type: 'after', callId: 'c7' }),
      JSON.stringify({ type: 'before', callId: 'c8', apiName: 'page.click' }),
      JSON.stringify({ type: 'after', callId: 'c8', error: { message: 'Element not found' } }),
      JSON.stringify({ type: 'before', callId: 'c9', apiName: 'page.screenshot' }),
      JSON.stringify({ type: 'after', callId: 'c9' }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.size).toBe(3);
    expect(result.failedAction?.callId).toBe('c8');
  });

  it('PARSE-15: should parse consolidated single action records', () => {
    const lines = [
      JSON.stringify({
        type: 'action',
        callId: 'c10',
        action: 'page.fill',
        params: { selector: 'input[name="email"]' },
        error: { message: 'Timeout' },
      }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.failedAction?.callId).toBe('c10');
    expect(result.failedAction?.action).toBe('page.fill');
  });

  it('PARSE-16: should handle oversized trace line strings without throwing buffer overflow', () => {
    const hugeText = 'A'.repeat(100000);
    const lines = [
      JSON.stringify({ type: 'before', callId: 'c11', apiName: 'page.evaluate', params: { script: hugeText } }),
      JSON.stringify({ type: 'after', callId: 'c11' }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.has('c11')).toBe(true);
  });

  it('PARSE-17: should resolve selector from locator apiName fallback when params.selector missing', () => {
    const lines = [
      JSON.stringify({ type: 'before', callId: 'c12', apiName: 'locator("button.submit").click' }),
      JSON.stringify({ type: 'after', callId: 'c12' }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.actions.get('c12')?.selector).toContain('locator("button.submit")');
  });

  it('PARSE-18: should extract error message string when error object is a plain string', () => {
    const lines = [
      JSON.stringify({ type: 'before', callId: 'c13', apiName: 'page.click' }),
      JSON.stringify({ type: 'after', callId: 'c13', error: 'Direct string failure' }),
    ];
    const result = TraceParser.parseTraceLines(lines);
    expect(result.failedAction?.errorMessage).toBe('Direct string failure');
  });

  it('PARSE-19: should mark sourceAvailable true when failed action contains sourceFile', () => {
    const traceLines = [
      JSON.stringify({
        type: 'before',
        callId: 'c14',
        apiName: 'page.click',
        stack: [{ file: 'tests/spec.ts', line: 10 }],
      }),
      JSON.stringify({ type: 'after', callId: 'c14', error: { message: 'Failed' } }),
    ];
    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.evidenceCompleteness.sourceAvailable).toBe(true);
  });

  it('PARSE-20: should set fallback values when no failed action is detected in trace', () => {
    const traceLines = [
      JSON.stringify({ type: 'version', version: 10 }),
      JSON.stringify({ type: 'before', callId: 'c15', apiName: 'page.goto' }),
      JSON.stringify({ type: 'after', callId: 'c15' }),
    ];
    const context = TraceParser.assembleDiagnosticContext(traceLines, []);
    expect(context.failedAction.callId).toBe('unknown');
    expect(context.failedAction.errorMessage).toContain('No explicit action failure');
  });
});
