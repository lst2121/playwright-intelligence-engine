import { DiagnosticContext } from '../core/types/diagnostic-context.js';
import { CorrelatedEvidence } from './evidence-correlator.js';

export class DiagnosticReportGenerator {
  public static generateTerminalReport(evidence: CorrelatedEvidence): string {
    const { context, classification } = evidence;
    const { failedAction } = context;

    const divider = '─'.repeat(72);
    const lines: string[] = [];

    lines.push('');
    lines.push('╔══════════════════════════════════════════════════════════════════════╗');
    lines.push('║             PLAYWRIGHT INTELLIGENCE ENGINE: DIAGNOSTIC REPORT        ║');
    lines.push('╚══════════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Summary Header
    lines.push(`Root Cause Classification : ${classification.category}`);
    lines.push(`Confidence Level          : ${(classification.confidence * 100).toFixed(1)}%`);
    lines.push(`Action Outcome            : ${classification.shouldAbstain ? '⛔ ABSTAIN FROM CODE REPAIR' : '🔍 REPAIR CANDIDATE AVAILABLE'}`);
    lines.push(divider);

    // Failed Action Context
    lines.push('Failed Action Details:');
    lines.push(`  • Call ID     : ${failedAction.callId}`);
    lines.push(`  • Method      : ${failedAction.action}`);
    if (failedAction.selector) {
      lines.push(`  • Selector    : ${failedAction.selector}`);
    }
    if (failedAction.sourceFile) {
      lines.push(`  • Source File : ${failedAction.sourceFile}:${failedAction.line ?? 0}:${failedAction.column ?? 0}`);
    }
    if (failedAction.durationMs) {
      lines.push(`  • Duration    : ${failedAction.durationMs}ms`);
    }
    if (failedAction.errorMessage) {
      lines.push(`  • Error       : ${failedAction.errorMessage}`);
    }
    lines.push(divider);

    // Evidence Completeness
    const comp = context.evidenceCompleteness;
    lines.push('Evidence Provenance:');
    lines.push(`  • DOM Snapshot Available : ${comp.domAvailable ? '✅ YES' : '❌ NO'}`);
    lines.push(`  • Network Logs Ingested  : ${comp.networkAvailable ? `✅ YES (${context.networkEvents.length} events)` : '❌ NONE'}`);
    lines.push(`  • Source Code Mapped     : ${comp.sourceAvailable ? '✅ YES' : '❌ NO'}`);
    lines.push(divider);

    // Suspicious Network & Console Context
    if (evidence.suspiciousNetworkEvents.length > 0) {
      lines.push('Correlated Network Anomalies:');
      for (const net of evidence.suspiciousNetworkEvents.slice(0, 5)) {
        lines.push(`  ⚠️  HTTP ${net.status} [${net.method}] ${net.url}`);
      }
      lines.push(divider);
    }

    if (evidence.suspiciousConsoleEvents.length > 0) {
      lines.push('Correlated Console Errors:');
      for (const con of evidence.suspiciousConsoleEvents.slice(0, 3)) {
        lines.push(`  ⚠️  ${con.text}`);
      }
      lines.push(divider);
    }

    // Abstention or Next Action
    if (classification.shouldAbstain) {
      lines.push('Abstention Rationale:');
      lines.push(`  ${classification.abstentionReason ?? classification.reason}`);
      lines.push('  Engine guardrail enforced: zero unsafe AST mutations attempted.');
    } else {
      lines.push('Diagnostic Conclusion:');
      lines.push(`  ${classification.reason}`);
      lines.push('  Ready for candidate extraction and isolated worktree verification.');
    }

    lines.push(divider);
    lines.push('');

    return lines.join('\n');
  }
}
