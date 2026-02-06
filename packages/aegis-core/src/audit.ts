import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditEventType } from "./types.js";

export type AuditLoggerOptions = {
  logPath?: string;
};

export class AuditLogger {
  private readonly logPath: string;

  constructor(opts: AuditLoggerOptions = {}) {
    this.logPath = opts.logPath ?? path.join(process.cwd(), "aegis_audit_log.jsonl");
  }

  append(params: {
    type: AuditEventType;
    requestId?: string;
    agentId?: string;
    sessionKey?: string;
    toolName?: string;
    payload: Record<string, unknown>;
    timestamp?: string;
  }): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: params.timestamp ?? new Date().toISOString(),
      type: params.type,
      requestId: params.requestId,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      toolName: params.toolName,
      payload: params.payload,
    };

    const line = JSON.stringify(entry);
    const existing = fs.existsSync(this.logPath) ? fs.readFileSync(this.logPath, "utf8") : "";
    const next = existing ? `${line}\n${existing}` : `${line}\n`;
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    fs.writeFileSync(this.logPath, next);
    return entry;
  }
}
