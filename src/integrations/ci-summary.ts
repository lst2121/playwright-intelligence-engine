export interface CiFailureSummary {
  status: 'PASS' | 'FAIL' | 'ABSTAIN' | 'BLOCKED';
  repository?: string;
  testIdentity?: string;
  category?: string;
  confidence?: number;
  reason: string;
  artifacts: string[];
  repairProposalAvailable: boolean;
  verifiedRepair: boolean;
}

export function renderCiSummary(summary: CiFailureSummary): string {
  const lines = [
    `## PIE result: ${summary.status}`,
    '',
    summary.repository ? `- Repository: \`${summary.repository}\`` : undefined,
    summary.testIdentity ? `- Test: \`${summary.testIdentity}\`` : undefined,
    summary.category ? `- Classification: \`${summary.category}\`` : undefined,
    summary.confidence === undefined ? undefined : `- Confidence: ${(summary.confidence * 100).toFixed(1)}%`,
    `- Repair proposal: ${summary.repairProposalAvailable ? 'available' : 'not available'}`,
    `- Browser verification: ${summary.verifiedRepair ? 'passed' : 'not verified'}`,
    `- Reason: ${summary.reason}`,
  ].filter((line): line is string => line !== undefined);

  if (summary.artifacts.length > 0) {
    lines.push('', '### Artifacts', ...summary.artifacts.map((artifact) => `- ${artifact}`));
  }

  return lines.join('\n');
}

export function renderGitHubAnnotation(summary: CiFailureSummary): string {
  const level = summary.status === 'FAIL' ? 'error' : summary.status === 'ABSTAIN' ? 'warning' : 'notice';
  return `::${level} title=PIE ${summary.status}::${summary.reason}`;
}

