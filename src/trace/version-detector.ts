import { UnsupportedTraceVersionError } from '../core/errors/engine-errors.js';

export interface TraceVersionInfo {
  traceFormatVersion: number;
  playwrightVersion?: string;
  isSupported: boolean;
}

export class VersionDetector {
  // Known supported Playwright trace format versions
  // v1.38-v1.40 uses version 5/6; v1.41-v1.50 uses version 7/8/9; v1.60+ uses version 10
  public static readonly SUPPORTED_FORMAT_VERSIONS = [5, 6, 7, 8, 9, 10];

  /**
   * Detects the trace format version from raw JSONL event lines or an archive entry.
   * Scans the first N events looking for a 'version' event or metadata object.
   * If no explicit version is found, returns version 0 (unknown/unsupported).
   */
  public static detectFromLines(lines: string[]): TraceVersionInfo {
    let traceFormatVersion = 0; // Unknown by default
    let playwrightVersion: string | undefined;
    let foundExplicitVersion = false;

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      try {
        const event = JSON.parse(line);

        // Check for { "type": "version", "version": 6 }
        if (event.type === 'version' && typeof event.version === 'number') {
          traceFormatVersion = event.version;
          foundExplicitVersion = true;
        }

        // Check for version embedded in context or metadata events
        if (event.type === 'context-options' || event.type === 'metadata') {
          if (typeof event.playwrightVersion === 'string') {
            playwrightVersion = event.playwrightVersion;
          }
          if (typeof event.version === 'number') {
            traceFormatVersion = event.version;
            foundExplicitVersion = true;
          }
        }

        // Break early if we found both
        if (foundExplicitVersion && playwrightVersion) {
          break;
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    const isSupported = foundExplicitVersion && VersionDetector.SUPPORTED_FORMAT_VERSIONS.includes(traceFormatVersion);

    return {
      traceFormatVersion,
      playwrightVersion: playwrightVersion ?? 'unknown',
      isSupported,
    };
  }

  /**
   * Asserts that a detected trace version is supported by the engine.
   * Throws UnsupportedTraceVersionError if not.
   */
  public static assertSupported(versionInfo: TraceVersionInfo): void {
    if (!versionInfo.isSupported) {
      throw new UnsupportedTraceVersionError(
        versionInfo.traceFormatVersion,
        `Trace format version ${versionInfo.traceFormatVersion} is not supported. Supported versions: ${VersionDetector.SUPPORTED_FORMAT_VERSIONS.join(', ')}`
      );
    }
  }
}

