import { DiagnosticContext } from '../../core/types/diagnostic-context.js';

export interface ArchiveManifest {
  archivePath: string;
  entryNames: string[];
  traceEntryName?: string | undefined;
  networkEntryName?: string | undefined;
  stacksEntryName?: string | undefined;
}

export interface AdapterValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface TraceAdapter {
  readonly adapterVersion: string;
  readonly supportedFormatVersions: number[];
  canParse(manifest: ArchiveManifest, sampleLines: string[]): boolean;
  parse(
    manifest: ArchiveManifest,
    traceLines: string[],
    networkLines: string[]
  ): Promise<DiagnosticContext>;
  validate(context: DiagnosticContext): AdapterValidationResult;
}

