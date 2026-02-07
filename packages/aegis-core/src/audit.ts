import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditEventType } from "./types.js";

export type AuditLoggerOptions = {
  logPath?: string;
  maxBytes?: number;
};

const DEFAULT_BASE_NAME = "aegis_audit";
const ARCHIVE_PREFIX = "Archived_";
const LOG_EXT = ".jsonl";

const padNumber = (value: number, size = 2) => String(value).padStart(size, "0");

const formatTimestamp = (date = new Date()): string => {
  const year = date.getUTCFullYear();
  const month = padNumber(date.getUTCMonth() + 1);
  const day = padNumber(date.getUTCDate());
  const hours = padNumber(date.getUTCHours());
  const minutes = padNumber(date.getUTCMinutes());
  const seconds = padNumber(date.getUTCSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeBaseName = (name: string): string => {
  let base = name;
  if (base.startsWith(ARCHIVE_PREFIX)) {
    base = base.slice(ARCHIVE_PREFIX.length);
  }
  if (base.startsWith(`${DEFAULT_BASE_NAME}_`) || base === DEFAULT_BASE_NAME) {
    return DEFAULT_BASE_NAME;
  }
  return base;
};

const extractTimestampFromName = (name: string, baseName: string): string | null => {
  const pattern = new RegExp(
    `^(?:${escapeRegex(ARCHIVE_PREFIX)})?${escapeRegex(baseName)}_(\\d{8}_\\d{6})$`,
  );
  const match = name.match(pattern);
  return match?.[1] ?? null;
};

export class AuditLogger {
  private logPath: string;
  private readonly maxBytes?: number;
  private readonly dir: string;
  private readonly baseName: string;

  constructor(opts: AuditLoggerOptions = {}) {
    this.logPath = opts.logPath ?? path.join(process.cwd(), `${DEFAULT_BASE_NAME}.jsonl`);
    this.maxBytes = opts.maxBytes;
    const parsed = path.parse(this.logPath);
    this.dir = parsed.dir || process.cwd();
    this.baseName = normalizeBaseName(parsed.name);
  }

  getLogPath(): string {
    return this.logPath;
  }

  private ensureLogDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private ensureLogFile() {
    this.ensureLogDir();
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, "");
    }
  }

  private buildLogFileName(timestamp: string) {
    return `${this.baseName}_${timestamp}${LOG_EXT}`;
  }

  private buildArchiveFileName(timestamp: string) {
    return `${ARCHIVE_PREFIX}${this.baseName}_${timestamp}${LOG_EXT}`;
  }

  private resolveUniquePath(targetPath: string): string {
    if (!fs.existsSync(targetPath)) {
      return targetPath;
    }
    const parsed = path.parse(targetPath);
    for (let i = 1; i < 1000; i += 1) {
      const candidate = path.join(parsed.dir, `${parsed.name}_${i}${parsed.ext}`);
      if (!fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return path.join(parsed.dir, `${parsed.name}_${Date.now()}${parsed.ext}`);
  }

  private rotateIfNeeded(nextBytes: number) {
    if (!this.maxBytes) {
      return;
    }
    if (!fs.existsSync(this.logPath)) {
      return;
    }
    const size = fs.statSync(this.logPath).size;
    if (size + nextBytes <= this.maxBytes) {
      return;
    }
    const parsed = path.parse(this.logPath);
    const stamp =
      extractTimestampFromName(parsed.name, this.baseName) ??
      formatTimestamp(fs.statSync(this.logPath).birthtime ?? new Date());
    const archivedName = this.buildArchiveFileName(stamp);
    const archivedPath = this.resolveUniquePath(path.join(this.dir, archivedName));
    try {
      fs.renameSync(this.logPath, archivedPath);
    } catch {
      // If rename fails, continue with a new log file while leaving the old one intact.
    }
    this.logPath = path.join(this.dir, this.buildLogFileName(formatTimestamp()));
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

    const line = `${JSON.stringify(entry)}\n`;
    const lineBytes = Buffer.byteLength(line);
    this.ensureLogFile();
    this.rotateIfNeeded(lineBytes);
    const existing = fs.existsSync(this.logPath) ? fs.readFileSync(this.logPath, "utf8") : "";
    const next = `${line}${existing}`;
    this.ensureLogDir();
    fs.writeFileSync(this.logPath, next);
    return entry;
  }
}
