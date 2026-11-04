import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { ArchiveReader } from '../../src/trace/archive-reader.js';
import { ZipSlipSecurityError, TraceCorruptedError } from '../../src/core/errors/engine-errors.js';

describe('ArchiveReader Unit Tests', () => {
  const testOutputDir = path.resolve('tests/fixtures/tmp-test-archives');
  const extractDir = path.resolve('tests/fixtures/tmp-extract');

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
    await fs.mkdir(extractDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
    await fs.rm(extractDir, { recursive: true, force: true });
  });

  it('should safely unpack a valid zip archive containing trace and network files', async () => {
    const validZipPath = path.join(testOutputDir, 'valid-trace.zip');
    const zip = new AdmZip();
    zip.addFile('trace.trace', Buffer.from('{"type":"action","callId":"1"}\n'));
    zip.addFile('trace.network', Buffer.from('{"type":"resource-snapshot"}\n'));
    zip.writeZip(validZipPath);

    const result = await ArchiveReader.unpackSafely(validZipPath, extractDir);

    expect(result.hasTraceEventFile).toBe(true);
    expect(result.hasNetworkEventFile).toBe(true);
    expect(result.entryNames).toContain('trace.trace');
    expect(result.entryNames).toContain('trace.network');

    const traceContent = await fs.readFile(path.join(extractDir, 'trace.trace'), 'utf8');
    expect(traceContent).toContain('"callId":"1"');
  });

  it('should read a single entry text directly without full extraction', async () => {
    const validZipPath = path.join(testOutputDir, 'quick-read.zip');
    const zip = new AdmZip();
    zip.addFile('metadata.json', Buffer.from(JSON.stringify({ version: 6 })));
    zip.writeZip(validZipPath);

    const content = await ArchiveReader.readEntryAsText(validZipPath, 'metadata.json');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(6);
  });

  it('should block Zip-Slip path traversal attacks and throw ZipSlipSecurityError', async () => {
    const maliciousZipPath = path.join(testOutputDir, 'malicious-slip.zip');
    const zip = new AdmZip();
    zip.addFile('dummy.txt', Buffer.from('pwned'));
    // Manually inject directory traversal in central directory header to simulate attacker zip
    zip.getEntries()[0]!.entryName = '../../malicious-payload.txt';
    zip.writeZip(maliciousZipPath);

    await expect(ArchiveReader.unpackSafely(maliciousZipPath, extractDir)).rejects.toThrow(
      ZipSlipSecurityError
    );
  });

  it('should reject zip archives that exceed entry limit (Zip-Bomb defense)', async () => {
    const bombZipPath = path.join(testOutputDir, 'bomb-entries.zip');
    const zip = new AdmZip();
    for (let i = 0; i < 15; i++) {
      zip.addFile(`file-${i}.txt`, Buffer.from('data'));
    }
    zip.writeZip(bombZipPath);

    await expect(
      ArchiveReader.unpackSafely(bombZipPath, extractDir, { maxEntries: 10 })
    ).rejects.toThrow(TraceCorruptedError);
  });

  it('should reject zip archives that exceed total size limit (Zip-Bomb defense)', async () => {
    const bombZipPath = path.join(testOutputDir, 'bomb-size.zip');
    const zip = new AdmZip();
    zip.addFile('big.txt', Buffer.alloc(1024 * 1024, 'a')); // 1 MB
    zip.writeZip(bombZipPath);

    await expect(
      ArchiveReader.unpackSafely(bombZipPath, extractDir, { maxTotalSize: 500 * 1024 }) // Limit: 500 KB
    ).rejects.toThrow(TraceCorruptedError);
  });

  it('should throw TraceCorruptedError on invalid/corrupted zip files', async () => {
    const corruptedZipPath = path.join(testOutputDir, 'corrupted.zip');
    await fs.writeFile(corruptedZipPath, Buffer.from('NOT A ZIP FILE'));

    await expect(ArchiveReader.unpackSafely(corruptedZipPath, extractDir)).rejects.toThrow(
      TraceCorruptedError
    );
  });
});
