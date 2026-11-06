import AdmZip from 'adm-zip';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ZipSlipSecurityError, TraceCorruptedError } from '../core/errors/engine-errors.js';

export interface UnpackOptions {
  maxTotalSize?: number;      // Default 500 MB
  maxEntries?: number;        // Default 10,000 entries
  targetDir?: string;         // Directory to extract to
}

export interface ExtractedTraceArchive {
  archivePath: string;
  extractDir: string;
  entryNames: string[];
  hasTraceEventFile: boolean;
  hasNetworkEventFile: boolean;
}

export interface TraceEntryDiscovery {
  /** Best stream for backward-compatible single-stream consumers. */
  traceEntryName?: string | undefined;
  networkEntryName?: string | undefined;
  /** All streams, ordered with explicit failure streams first. */
  traceEntryNames?: string[] | undefined;
  networkEntryNames?: string[] | undefined;
}

export class ArchiveReader {
  private static readonly DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100 MB max uncompressed
  private static readonly DEFAULT_MAX_ENTRIES = 10000;
  private static readonly MAX_COMPRESSION_RATIO = 10; // 10:1 ratio protection
  private static readonly MAX_SINGLE_ENTRY_SIZE = 50 * 1024 * 1024; // 50 MB max single entry

  /**
   * Automatically discovers the primary trace and network JSONL entry names inside a Playwright trace archive.
   * Matches stream and worker IDs between .trace and .network files to prevent cross-worker mismatch.
   */
  public static findTraceFileEntries(zipPath: string): TraceEntryDiscovery {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      // A Playwright archive can contain several streams. The largest stream is
      // often a browser/page stream, while the runner's test.trace contains the
      // actual failed pw:api action and error. Prefer the stream with explicit
      // failed-action evidence, then fall back to the largest stream for older
      // or minimal archives.
      const traceCandidates = entries
        .filter((e) => e.entryName.endsWith('.trace'))
        .map((entry) => {
          const text = entry.getData().toString('utf8');
          const lines = text.split(/\r?\n/);
          let failureScore = 0;
          for (const line of lines) {
            if (!line.includes('"type":"')) continue;
            if (line.includes('"type":"after"') && line.includes('"error"')) failureScore += 100;
            if (line.includes('"type":"error"') && (line.includes('"message"') || line.includes('"error"'))) failureScore += 80;
            if (line.includes('"type":"log"')) failureScore += 1;
          }
          if (path.basename(entry.entryName).toLowerCase() === 'test.trace' && failureScore > 0) {
            failureScore += 10;
          }
          return { entry, failureScore };
        })
        .sort((a, b) => b.failureScore - a.failureScore || b.entry.header.size - a.entry.header.size);

      const orderedTraceNames = traceCandidates.map(({ entry }) => entry.entryName);
      const bestTrace = orderedTraceNames[0];
      if (!bestTrace) {
        return {};
      }

      // Correlate network entry with matching stream / worker prefix if possible
      const traceBase = path.basename(bestTrace, '.trace');
      const networkCandidates = entries.filter((e) => e.entryName.endsWith('.network'));
      const networkEntryNames = networkCandidates.map((entry) => entry.entryName);

      let bestNetwork: string | undefined;
      // 1. Exact base match (e.g. 0.trace -> 0.network, trace.trace -> trace.network)
      const exactMatch = networkCandidates.find((e) => path.basename(e.entryName, '.network') === traceBase);
      if (exactMatch) {
        bestNetwork = exactMatch.entryName;
      } else {
        // 2. Prefix match (e.g. 0-trace.trace -> 0-network.network or 0.network)
        const workerPrefix = traceBase.split('-')[0] ?? '';
        const prefixMatch = networkCandidates.find((e) => path.basename(e.entryName, '.network').startsWith(workerPrefix));
        bestNetwork = prefixMatch ? prefixMatch.entryName : networkCandidates.sort((a, b) => b.header.size - a.header.size)[0]?.entryName;
      }

      return {
        traceEntryName: bestTrace,
        networkEntryName: bestNetwork,
        traceEntryNames: orderedTraceNames,
        networkEntryNames,
      };
    } catch {
      return {};
    }
  }

  /** Reads multiple archive entries and joins them as one logical JSONL stream. */
  public static async readEntriesAsText(zipPath: string, entryNames: string[]): Promise<string> {
    const uniqueNames = [...new Set(entryNames.filter(Boolean))];
    const texts = await Promise.all(uniqueNames.map((entryName) => ArchiveReader.readEntryAsText(zipPath, entryName)));
    return texts.join('\n');
  }

  /**
   * Reads a single entry as a UTF-8 string directly from a .zip file in memory
   * with strict per-entry size limits.
   */
  public static async readEntryAsText(zipPath: string, entryName: string): Promise<string> {
    try {
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry(entryName);
      if (!entry) {
        throw new Error(`Entry '${entryName}' not found in archive '${zipPath}'`);
      }
      if (entry.header.size > ArchiveReader.MAX_SINGLE_ENTRY_SIZE) {
        throw new TraceCorruptedError(
          zipPath,
          `Entry '${entryName}' size ${entry.header.size} bytes exceeds single entry limit of ${ArchiveReader.MAX_SINGLE_ENTRY_SIZE} bytes`
        );
      }
      return entry.getData().toString('utf8');
    } catch (err: any) {
      if (err instanceof ZipSlipSecurityError) throw err;
      throw new TraceCorruptedError(zipPath, err.message);
    }
  }

  /**
   * Safely unpacks a Playwright trace.zip archive to an isolated destination directory
   * with strict Zip-Slip and Zip-Bomb protections.
   */
  public static async unpackSafely(
    zipPath: string,
    destinationDir: string,
    options?: UnpackOptions
  ): Promise<ExtractedTraceArchive> {
    const maxSize = options?.maxTotalSize ?? ArchiveReader.DEFAULT_MAX_SIZE;
    const maxEntries = options?.maxEntries ?? ArchiveReader.DEFAULT_MAX_ENTRIES;

    const resolvedDest = path.resolve(destinationDir);
    await fs.mkdir(resolvedDest, { recursive: true });

    let zip: AdmZip;
    try {
      zip = new AdmZip(zipPath);
    } catch (err: any) {
      throw new TraceCorruptedError(zipPath, `Failed to initialize zip reader: ${err.message}`);
    }

    const entries = zip.getEntries();
    if (entries.length > maxEntries) {
      throw new TraceCorruptedError(
        zipPath,
        `Zip-Bomb suspected: archive contains ${entries.length} entries (max allowed: ${maxEntries})`
      );
    }

    let totalSize = 0;
    const entryNames: string[] = [];

    // Phase 1: Validate all entries BEFORE writing anything to disk (All-or-nothing check)
    for (const entry of entries) {
      totalSize += entry.header.size;
      if (totalSize > maxSize) {
        throw new TraceCorruptedError(
          zipPath,
          `Zip-Bomb suspected: uncompressed size exceeded limit of ${maxSize} bytes`
        );
      }

      // Check for Zip-Bomb compression ratio anomaly (e.g. 100:1 ratio)
      if (entry.header.compressedSize > 0 && entry.header.size > 512 * 1024) {
        const ratio = entry.header.size / entry.header.compressedSize;
        if (ratio > ArchiveReader.MAX_COMPRESSION_RATIO) {
          throw new TraceCorruptedError(
            zipPath,
            `Zip-Bomb suspected: compression ratio ${ratio.toFixed(1)}:1 exceeds limit of ${ArchiveReader.MAX_COMPRESSION_RATIO}:1 for entry '${entry.entryName}'`
          );
        }
      }

      // Check for Zip-Slip path traversal vulnerability
      const targetFilePath = path.resolve(resolvedDest, entry.entryName);
      // Ensure target path is strictly within destination directory
      const relative = path.relative(resolvedDest, targetFilePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new ZipSlipSecurityError(entry.entryName);
      }

      entryNames.push(entry.entryName);
    }

    // Phase 2: Safe extraction
    for (const entry of entries) {
      const targetFilePath = path.resolve(resolvedDest, entry.entryName);
      if (entry.isDirectory) {
        await fs.mkdir(targetFilePath, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
        const content = entry.getData();
        await fs.writeFile(targetFilePath, content);
      }
    }

    const hasTraceEventFile = entryNames.some(
      (name) => name === 'trace.trace' || name.endsWith('.trace')
    );
    const hasNetworkEventFile = entryNames.some(
      (name) => name === 'trace.network' || name.endsWith('.network')
    );

    return {
      archivePath: zipPath,
      extractDir: resolvedDest,
      entryNames,
      hasTraceEventFile,
      hasNetworkEventFile,
    };
  }
}

