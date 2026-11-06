import type { CiEvidenceReport } from './playwright-report-adapter.js';

export interface SarifReport {
  version: '2.1.0';
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json';
  runs: Array<{
    tool: { driver: { name: string; version: string; informationUri: string; rules: SarifRule[] } };
    results: SarifResult[];
  }>;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  properties: Record<string, string | number | boolean>;
  locations?: Array<{ physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } } }>;
}

function levelForSeverity(severity: string): SarifResult['level'] {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

function ruleForCategory(category: string, level: SarifResult['level']): SarifRule {
  return {
    id: `PIE-${category}`,
    name: category,
    shortDescription: { text: `PIE failure category ${category}` },
    defaultConfiguration: { level },
  };
}

/** Converts normalized PIE CI evidence into a standard SARIF 2.1.0 artifact. */
export function buildSarifReport(report: CiEvidenceReport, toolVersion = '0.1.0'): SarifReport {
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const cluster of report.clusters) {
    const level = levelForSeverity(cluster.severity);
    const category = cluster.fingerprint.category;
    const ruleId = `PIE-${category}`;
    if (!rules.has(ruleId)) rules.set(ruleId, ruleForCategory(category, level));
    const representative = cluster.representative;
    const result: SarifResult = {
      ruleId,
      level,
      message: { text: `${category}: ${representative.errorMessage ?? 'Failure cluster detected'}` },
      properties: {
        clusterId: cluster.clusterId,
        count: cluster.count,
        severity: cluster.severity,
        affectedTests: cluster.affectedTests.length,
        affectedRepositories: cluster.affectedRepositories.length,
      },
    };
    if (representative.sourceFile) {
      result.locations = [{
        physicalLocation: {
          artifactLocation: { uri: representative.sourceFile.replace(/\\/g, '/') },
        },
      }];
    }
    results.push(result);
  }

  const gateRuleId = 'PIE-QUALITY-GATE';
  const gateLevel: SarifResult['level'] = report.qualityGate.status === 'FAIL' ? 'error' : report.qualityGate.status === 'ABSTAIN' ? 'warning' : 'note';
  rules.set(gateRuleId, {
    id: gateRuleId,
    name: 'Quality gate',
    shortDescription: { text: 'PIE deterministic CI quality gate' },
    defaultConfiguration: { level: gateLevel },
  });
  results.push({
    ruleId: gateRuleId,
    level: gateLevel,
    message: { text: `PIE quality gate: ${report.qualityGate.status}${report.qualityGate.reasons.length ? ` — ${report.qualityGate.reasons.join('; ')}` : ''}` },
    properties: {
      status: report.qualityGate.status,
      testsObserved: report.runs.length,
      failures: report.failures.length,
      flakyTests: report.stability.filter((test) => test.flaky).length,
    },
  });

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'PIE',
          version: toolVersion,
          informationUri: 'https://github.com/playwright-intelligence-engine',
          rules: [...rules.values()],
        },
      },
      results,
    }],
  };
}
