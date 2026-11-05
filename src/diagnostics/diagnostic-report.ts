import { CorrelatedEvidence } from './evidence-correlator.js';
import { EvidenceScorecard } from '../evidence/evidence-model.js';

export class DiagnosticReportGenerator {
  public static generateTerminalReport(
    evidence: CorrelatedEvidence,
    scorecard?: EvidenceScorecard
  ): string {
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

    // Evidence Scorecard / Completeness
    if (scorecard) {
      lines.push('Multi-Source Evidence Scorecard:');
      lines.push(`  • Playwright Error Msg   : ${scorecard.playwrightErrorAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Test Source AST        : ${scorecard.testSourceAstAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • DOM Snapshot           : ${scorecard.domSnapshotAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Network Events         : ${scorecard.networkEventsAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Console Events         : ${scorecard.consoleEventsAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Trace Archive          : ${scorecard.traceArchiveAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Git Working Tree Diff  : ${scorecard.gitHistoryAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Environment Metadata   : ${scorecard.environmentMetadataAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Total Ingested Records : ${scorecard.totalRecordsCount}`);
    } else {
      const comp = context.evidenceCompleteness;
      lines.push('Evidence Provenance:');
      lines.push(`  • DOM Snapshot Available : ${comp.domAvailable ? '✅ YES' : '❌ NO'}`);
      lines.push(`  • Network Logs Ingested  : ${comp.networkAvailable ? `✅ YES (${context.networkEvents.length} events)` : '❌ NONE'}`);
      lines.push(`  • Source Code Mapped     : ${comp.sourceAvailable ? '✅ YES' : '❌ NO'}`);
    }
    lines.push(divider);

    // Causal Evidence Graph summary
    if (classification.causalGraph) {
      const g = classification.causalGraph;
      lines.push('Causal Evidence Graph:');
      lines.push(`  • Graph Size   : ${g.nodes.length} nodes, ${g.edges?.length ?? 0} causal edges`);
      if (g.hasCausallyRelevantServerError && g.offendingNetworkEvent) {
        lines.push(`  • Offending Request: HTTP ${g.offendingNetworkEvent.status} on ${g.offendingNetworkEvent.method} ${g.offendingNetworkEvent.url}`);
      }
      lines.push(divider);
    }

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

  public static generateMarkdownReport(
    evidence: CorrelatedEvidence,
    scorecard?: EvidenceScorecard
  ): string {
    const { context, classification } = evidence;
    const { failedAction } = context;

    const md: string[] = [];
    md.push('# Playwright Intelligence Engine — Diagnostic Report');
    md.push('');
    md.push(`**Classification:** \`${classification.category}\` (Confidence: ${(classification.confidence * 100).toFixed(1)}%)  `);
    md.push(`**Status:** ${classification.shouldAbstain ? '⛔ **Abstained from repair**' : '🔍 **Repair candidate eligible**'}  `);
    md.push(`**Reason:** ${classification.reason}  `);
    md.push('');

    md.push('## Failed Action');
    md.push(`- **Action:** \`${failedAction.action}\``);
    if (failedAction.selector) md.push(`- **Selector:** \`${failedAction.selector}\``);
    if (failedAction.sourceFile) md.push(`- **Location:** \`${failedAction.sourceFile}:${failedAction.line ?? 0}\``);
    if (failedAction.errorMessage) md.push(`- **Error:** \`${failedAction.errorMessage}\``);
    md.push('');

    if (scorecard) {
      md.push('## Evidence Scorecard');
      md.push('| Evidence Channel | Available |');
      md.push('|---|---|');
      md.push(`| Playwright Error Message | ${scorecard.playwrightErrorAvailable ? '✅' : '❌'} |`);
      md.push(`| Test Source Code (AST) | ${scorecard.testSourceAstAvailable ? '✅' : '❌'} |`);
      md.push(`| Browser DOM Snapshot | ${scorecard.domSnapshotAvailable ? '✅' : '❌'} |`);
      md.push(`| Network Interception | ${scorecard.networkEventsAvailable ? '✅' : '❌'} |`);
      md.push(`| Browser Console | ${scorecard.consoleEventsAvailable ? '✅' : '❌'} |`);
      md.push(`| Playwright Trace | ${scorecard.traceArchiveAvailable ? '✅' : '❌'} |`);
      md.push(`| Git History / Diff | ${scorecard.gitHistoryAvailable ? '✅' : '❌'} |`);
      md.push(`| Environment Metadata | ${scorecard.environmentMetadataAvailable ? '✅' : '❌'} |`);
      md.push('');
    }

    if (classification.shouldAbstain) {
      md.push('## Abstention Guardrail Enforced');
      md.push(`> [!IMPORTANT]\n> ${classification.abstentionReason ?? classification.reason}`);
    }

    return md.join('\n');
  }
}
