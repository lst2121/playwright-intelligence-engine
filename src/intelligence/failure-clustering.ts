import crypto from 'node:crypto';
import { normalizeFailureCategory } from '../diagnostics/failure-category.js';

export interface FailureObservation {
  id: string;
  repository?: string | undefined;
  testTitle?: string | undefined;
  sourceFile?: string | undefined;
  category: string;
  action?: string | undefined;
  selector?: string | undefined;
  errorMessage?: string | undefined;
  errorStack?: string | undefined;
  networkStatuses?: number[] | undefined;
  tracePath?: string | undefined;
  timestamp?: number | undefined;
  durationMs?: number | undefined;
}

export interface FailureFingerprint {
  key: string;
  category: string;
  action: string;
  messageSignature: string;
  networkSignature: string;
}

export interface FailureCluster {
  clusterId: string;
  fingerprint: FailureFingerprint;
  count: number;
  observationIds: string[];
  affectedRepositories: string[];
  affectedTests: string[];
  representative: FailureObservation;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  evidenceConsistency: number;
  firstSeen?: number | undefined;
  lastSeen?: number | undefined;
}

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const PATH_PATTERN = /(?:[a-zA-Z]:[\\/]|\/)[^\s'"`]+/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;
const HASH_PATTERN = /\b[0-9a-f]{8,}\b/gi;
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

function normalizeText(value: string | undefined): string {
  return (value ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(PATH_PATTERN, '<path>')
    .replace(UUID_PATTERN, '<uuid>')
    .replace(HASH_PATTERN, '<hash>')
    .replace(NUMBER_PATTERN, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function messageSignature(observation: FailureObservation): string {
  const source = observation.errorMessage || observation.errorStack || 'no-error-message';
  const firstUsefulLine = source
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .find((line) => line.length > 0) ?? 'no-error-message';
  return firstUsefulLine.slice(0, 300);
}

function networkSignature(statuses: number[] | undefined): string {
  return [...new Set(statuses ?? [])].sort((left, right) => left - right).join(',') || 'none';
}

export function fingerprintFailure(observation: FailureObservation): FailureFingerprint {
  const category = normalizeFailureCategory(observation.category);
  const action = normalizeText(observation.action) || 'unknown-action';
  const message = messageSignature(observation);
  const network = networkSignature(observation.networkStatuses);
  const material = [category, action, message, network].join('|');
  const digest = crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
  return {
    key: `failure-${digest}`,
    category,
    action,
    messageSignature: message,
    networkSignature: network,
  };
}

function severityFor(category: string): FailureCluster['severity'] {
  const normalized = category.toUpperCase();
  if (['BACKEND_500', 'ASSERTION_FAILURE', 'ASSERTION_FAILED', 'BUSINESS_DEFECT', 'TEST_FAILURE'].includes(normalized)) return 'critical';
  if (['AUTH_EXPIRED', 'AUTH_SESSION_EXPIRED', 'NETWORK_OFFLINE', 'ENVIRONMENT_FAILURE'].includes(normalized)) return 'high';
  if (['LOCATOR_DRIFT', 'AMBIGUOUS_MATCH', 'OBSTRUCTED_ELEMENT', 'DISABLED_ELEMENT', 'FRAME_OR_IFRAME'].includes(normalized)) return 'medium';
  if (['TIMING_RACE', 'DYNAMIC_CONTENT_SLOW', 'HYDRATION_OR_TIMING'].includes(normalized)) return 'low';
  return 'unknown';
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

export function clusterFailures(observations: FailureObservation[]): FailureCluster[] {
  const groups = new Map<string, { fingerprint: FailureFingerprint; observations: FailureObservation[] }>();
  for (const observation of observations) {
    const fingerprint = fingerprintFailure(observation);
    const group = groups.get(fingerprint.key);
    if (group) group.observations.push(observation);
    else groups.set(fingerprint.key, { fingerprint, observations: [observation] });
  }

  return [...groups.values()].map(({ fingerprint, observations }) => {
    const timestamps = observations.map((observation) => observation.timestamp).filter((value): value is number => typeof value === 'number');
    const repositories = uniqueSorted(observations.map((observation) => observation.repository));
    const tests = uniqueSorted(observations.map((observation) => observation.testTitle));
    const categoryAgreement = observations.every((observation) => normalizeFailureCategory(observation.category) === fingerprint.category) ? 1 : 0.5;
    const actionAgreement = observations.every((observation) => normalizeText(observation.action) === fingerprint.action) ? 1 : 0.5;
    return {
      clusterId: fingerprint.key,
      fingerprint,
      count: observations.length,
      observationIds: observations.map((observation) => observation.id).sort(),
      affectedRepositories: repositories,
      affectedTests: tests,
      representative: observations[0]!,
      severity: severityFor(fingerprint.category),
      evidenceConsistency: Number(((categoryAgreement + actionAgreement) / 2).toFixed(3)),
      firstSeen: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      lastSeen: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    };
  }).sort((left, right) => {
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
    return severityRank[right.severity] - severityRank[left.severity] || right.count - left.count || left.clusterId.localeCompare(right.clusterId);
  });
}
