import { TraceAdapter, ArchiveManifest, AdapterValidationResult } from './trace-adapter.js';
import { DiagnosticContext } from '../../core/types/diagnostic-context.js';
import { TraceParser } from '../trace-parser.js';
import { VersionDetector } from '../version-detector.js';

export class V9TraceAdapter implements TraceAdapter {
  public readonly adapterVersion = '1.0.0-v9';
  public readonly supportedFormatVersions = [9];

  public canParse(_manifest: ArchiveManifest, sampleLines: string[]): boolean {
    const versionInfo = VersionDetector.detectFromLines(sampleLines);
    return this.supportedFormatVersions.includes(versionInfo.traceFormatVersion);
  }

  public async parse(
    _manifest: ArchiveManifest,
    traceLines: string[],
    networkLines: string[]
  ): Promise<DiagnosticContext> {
    const context = TraceParser.assembleDiagnosticContext(traceLines, networkLines);
    return context;
  }

  public validate(context: DiagnosticContext): AdapterValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!context.failedAction.action || context.failedAction.action === 'unknown') {
      warnings.push('Action name was unknown in v9 format stream');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
