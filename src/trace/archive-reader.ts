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

export class ArchiveReader {
  private static readonly DEFAULT_MAX_SIZE = 500 * 1024 * 1024; // 500 MB
  private static readonly DEFAULT_MAX_ENTRIES = 10000;

  /**
   * Reads a single entry as a UTF-8 string directly from a .zip file in memory.
   */
  public static async readEntryAsText(zipPath: string, entryName: string): Promise<string> {
    try {
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry(entryName);
      if (!entry) {
        throw new Error(`Entry '${entryName}' not found in archive '${zipPath}'`);
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

