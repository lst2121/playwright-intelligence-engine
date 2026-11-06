import fs from 'node:fs/promises';
import path from 'node:path';
import type { QualityGatePolicy } from '../integrations/quality-gate.js';

export const GOVERNANCE_POLICY_VERSION = 1;

export interface PieGovernancePolicy {
  version: typeof GOVERNANCE_POLICY_VERSION;
  name: string;
  updatedAt: string;
  qualityGate: QualityGatePolicy;
  audit: {
    requireValidChain: boolean;
  };
}

export interface GovernancePolicyResult {
  policy: PieGovernancePolicy;
  policyPath: string;
  created: boolean;
}

export const DEFAULT_GOVERNANCE_POLICY: PieGovernancePolicy = {
  version: GOVERNANCE_POLICY_VERSION,
  name: 'team-default',
  updatedAt: '',
  qualityGate: {
    name: 'team-default',
    maxFlakyTests: 0,
    maxHighSeverityClusters: 0,
    maxBlockedResults: 0,
    failOnAbstain: false,
  },
  audit: {
    requireValidChain: true,
  },
};

export async function loadGovernancePolicy(root = process.cwd()): Promise<PieGovernancePolicy | undefined> {
  const policyPath = path.join(path.resolve(root), '.pie', 'governance.json');
  try {
    const parsed = JSON.parse(await fs.readFile(policyPath, 'utf8')) as Partial<PieGovernancePolicy>;
    if (parsed.version !== GOVERNANCE_POLICY_VERSION || !parsed.name || !parsed.qualityGate || !parsed.audit) return undefined;
    return parsed as PieGovernancePolicy;
  } catch {
    return undefined;
  }
}

export async function initializeGovernancePolicy(
  root = process.cwd(),
  options: { force?: boolean | undefined; policy?: Partial<PieGovernancePolicy> | undefined; now?: Date | undefined } = {},
): Promise<GovernancePolicyResult> {
  const projectRoot = path.resolve(root);
  const policyPath = path.join(projectRoot, '.pie', 'governance.json');
  if (!options.force) {
    const existing = await loadGovernancePolicy(projectRoot);
    if (existing) return { policy: existing, policyPath, created: false };
  }
  const supplied = options.policy ?? {};
  const policy: PieGovernancePolicy = {
    ...DEFAULT_GOVERNANCE_POLICY,
    ...supplied,
    name: supplied.name ?? DEFAULT_GOVERNANCE_POLICY.name,
    updatedAt: (options.now ?? new Date()).toISOString(),
    qualityGate: { ...DEFAULT_GOVERNANCE_POLICY.qualityGate, ...(supplied.qualityGate ?? {}), name: supplied.qualityGate?.name ?? supplied.name ?? DEFAULT_GOVERNANCE_POLICY.qualityGate.name },
    audit: { ...DEFAULT_GOVERNANCE_POLICY.audit, ...(supplied.audit ?? {}) },
  };
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  return { policy, policyPath, created: true };
}
