import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '../types/index.js';

export class AuditLogger {
  private events: AuditEvent[] = [];
  private readonly logPath: string;

  constructor(logPath = path.join(process.cwd(), 'audit_log.jsonl')) {
    this.logPath = logPath;
  }

  append(event: Omit<AuditEvent, 'id' | 'timestamp'> & { timestamp?: string }): AuditEvent {
    const record: AuditEvent = {
      id: randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type,
      taskId: event.taskId,
      payload: event.payload
    };
    this.events.push(record);
    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`);
    return record;
  }

  getEvents(): AuditEvent[] {
    return [...this.events];
  }

  replayTask(taskId: string): void {
    const events = this.events.filter((event) => event.taskId === taskId);
    console.log(`Replay for task ${taskId}:`);
    for (const event of events) {
      console.log(JSON.stringify(event, null, 2));
    }
  }
}
