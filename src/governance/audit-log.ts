import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface AuditEvent {
  eventId: string;
  timestamp: number;
  actor: 'system' | 'operator' | 'model';
  action: string;
  outcome: 'allowed' | 'denied' | 'abstained' | 'failed';
  target?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
  previousHash: string;
  hash: string;
}

type UnsignedAuditEvent = {
  eventId: string;
  timestamp: number;
  actor: AuditEvent['actor'];
  action: string;
  outcome: AuditEvent['outcome'];
  target?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
  previousHash: string;
};

function stablePayload(event: UnsignedAuditEvent): string {
  return JSON.stringify({
    eventId: event.eventId,
    timestamp: event.timestamp,
    actor: event.actor,
    action: event.action,
    outcome: event.outcome,
    target: event.target,
    metadata: event.metadata,
    previousHash: event.previousHash,
  });
}

export class AuditLog {
  private readonly logPath: string;

  public constructor(baseDir = '.') {
    this.logPath = path.resolve(baseDir, '.pw-intelligence', 'audit.log');
  }

  public async append(event: Omit<AuditEvent, 'eventId' | 'timestamp' | 'previousHash' | 'hash'>): Promise<AuditEvent> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    const previousHash = await this.lastHash();
    const unsigned: UnsignedAuditEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      previousHash,
    };
    const hash = crypto.createHash('sha256').update(stablePayload(unsigned)).digest('hex');
    const signed: AuditEvent = { ...unsigned, hash };
    await fs.appendFile(this.logPath, `${JSON.stringify(signed)}\n`, 'utf8');
    return signed;
  }

  public async verify(): Promise<{ valid: boolean; eventCount: number; reason?: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(this.logPath, 'utf8');
    } catch {
      return { valid: true, eventCount: 0 };
    }

    let previousHash = '';
    let eventCount = 0;
    for (const line of raw.split('\n').filter(Boolean)) {
      let event: AuditEvent;
      try {
        event = JSON.parse(line) as AuditEvent;
      } catch {
        return { valid: false, eventCount, reason: 'Invalid JSON event' };
      }
      if (event.previousHash !== previousHash) {
        return { valid: false, eventCount, reason: `Hash chain mismatch at event ${event.eventId}` };
      }
      const unsigned: UnsignedAuditEvent = {
        eventId: event.eventId,
        timestamp: event.timestamp,
        actor: event.actor,
        action: event.action,
        outcome: event.outcome,
        target: event.target,
        metadata: event.metadata,
        previousHash: event.previousHash,
      };
      const expected = crypto.createHash('sha256').update(stablePayload(unsigned)).digest('hex');
      if (event.hash !== expected) {
        return { valid: false, eventCount, reason: `Event hash mismatch at event ${event.eventId}` };
      }
      previousHash = event.hash;
      eventCount += 1;
    }
    return { valid: true, eventCount };
  }

  private async lastHash(): Promise<string> {
    try {
      const raw = await fs.readFile(this.logPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length === 0) return '';
      const last = JSON.parse(lines[lines.length - 1]!) as AuditEvent;
      return last.hash;
    } catch {
      return '';
    }
  }
}

