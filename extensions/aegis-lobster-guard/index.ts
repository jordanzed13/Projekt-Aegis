import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const REDACTED = "******";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizePipeline(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  let pipeline = raw;

  // Replace quoted literals (often contain secrets, payloads, or PII).
  pipeline = pipeline.replace(/'[^']*'/g, `'${REDACTED}'`);
  pipeline = pipeline.replace(/\"[^\"]*\"/g, `"${REDACTED}"`);

  // Mask common Windows user path segments.
  pipeline = pipeline.replace(/([A-Z]:\\\\Users\\\\)[^\\\\\\s]+/gi, `$1<user>`);

  // Mask absolute Windows paths (best-effort).
  pipeline = pipeline.replace(/[A-Z]:\\\\[^\\s'\"|]+/gi, "<path>");

  // Mask obvious bearer / API token forms (best-effort).
  pipeline = pipeline.replace(/Bearer\\s+[A-Za-z0-9._\\-]+/g, `Bearer ${REDACTED}`);

  return pipeline;
}

function sanitizeLobsterParams(params: Record<string, unknown>) {
  const action = typeof params.action === "string" ? params.action : undefined;
  const cwd = typeof params.cwd === "string" ? params.cwd : undefined;
  const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
  const maxStdoutBytes = typeof params.maxStdoutBytes === "number" ? params.maxStdoutBytes : undefined;

  return {
    action,
    pipeline: sanitizePipeline(params.pipeline),
    // argsJson often contains structured user data; always redact.
    argsJson: params.argsJson !== undefined ? REDACTED : undefined,
    // resume token should never be logged.
    token: params.token !== undefined ? REDACTED : undefined,
    approve: typeof params.approve === "boolean" ? params.approve : undefined,
    cwd,
    // lobsterPath may be an absolute path; keep only basename.
    lobsterPath:
      typeof params.lobsterPath === "string" && params.lobsterPath.trim()
        ? path.basename(params.lobsterPath.trim())
        : undefined,
    timeoutMs,
    maxStdoutBytes,
  };
}

function appendJsonlLine(logPath: string, line: Record<string, unknown>) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // Silent: this guard must never break the gateway.
  }
}

async function postAudit(controllerUrl: string, payload: Record<string, unknown>) {
  try {
    await fetch(`${controllerUrl}/audit/lobster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Silent.
  }
}

export default function register(api: any) {
  api.on(
    "before_tool_call",
    async (event: { toolName: string; params: Record<string, unknown> }, ctx: any) => {
      if (event.toolName !== "lobster" || !isPlainObject(event.params)) {
        return;
      }

      const controllerUrl =
        api.pluginConfig && typeof api.pluginConfig.controllerUrl === "string"
          ? api.pluginConfig.controllerUrl
          : undefined;
      const logPath =
        typeof process.env.AEGIS_AUDIT_LOG_PATH === "string" && process.env.AEGIS_AUDIT_LOG_PATH.trim()
          ? process.env.AEGIS_AUDIT_LOG_PATH.trim()
          : undefined;

      const entry = {
        type: "LOBSTER_WORKFLOW",
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        agentId: ctx?.agentId ?? "unknown",
        sessionKey: ctx?.sessionKey ?? "unknown",
        toolName: "lobster",
        payload: {
          phase: "before_tool_call",
          params: sanitizeLobsterParams(event.params),
        },
      };

      if (controllerUrl) {
        await postAudit(controllerUrl, entry);
      } else if (logPath) {
        appendJsonlLine(logPath, entry);
      }
    },
    { priority: 50 },
  );
}

