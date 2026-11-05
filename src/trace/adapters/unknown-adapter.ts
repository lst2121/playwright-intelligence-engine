import { TraceAdapter, ArchiveManifest, AdapterValidationResult } from './trace-adapter.js';
import { DiagnosticContext } from '../../core/types/diagnostic-context.js';
import { VersionDetector } from '../version-detector.js';

export class UnknownTraceAdapter implements TraceAdapter {
  public readonly adapterVersion = '1.0.0-unsupported';
  public readonly supportedFormatVersions: number[] = [];

  public canParse(_manifest: ArchiveManifest, _sampleLines: string[]): boolean {
    return true; // Catch-all fallback
  }

  public async parse(
    _manifest: ArchiveManifest,
    traceLines: string[],
    _networkLines: string[]
  ): Promise<DiagnosticContext> {
    const versionInfo = VersionDetector.detectFromLines(traceLines);

    return {
      playwrightVersion: versionInfo.playwrightVersion ?? 'unknown',
      traceFormatVersion: versionInfo.traceFormatVersion,
      failedAction: {
        callId: 'unknown',
        action: 'unknown',
        errorMessage: `Unsupported trace format version: ${versionInfo.traceFormatVersion}`,
      },
      snapshots: {},
      networkEvents: [],
      consoleEvents: [],
      failureCategory: 'UNSUPPORTED_TRACE_FORMAT',
      evidenceCompleteness: {
        domAvailable: false,
        networkAvailable: false,
        sourceAvailable: false,
      },
    };
  }

  public validate(context: DiagnosticContext): AdapterValidationResult {
    return {
      isValid: false,
      errors: [
        `UNSUPPORTED_TRACE_FORMAT: Trace format version ${context.traceFormatVersion} is not supported by any active trace adapter. Engine strictly abstains from inventing unverified diagnostics.`,
      ],
      warnings: [],
    };
  }
}

