import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AuditLogger, decideRisk, type AuditEntry, type ToolCallRequest } from "@aegis/core";
import type { GatewayClient } from "./gateway-client.js";
import type { ApprovalManager } from "./approvals.js";
import { invokeLocalTool, isLocalTool } from "./local-tools.js";
import { invokeTool } from "./tool-invoke.js";
import type { ControllerConfig } from "./config.js";
import { AlertMetrics } from "./metrics.js";
import { type PolicyFileState, resolvePolicy } from "./policy-file.js";

export type ProxyRequest = {
  requestId?: string;
  agentId: string;
  sessionKey: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type ProxyResponse = {
  ok: boolean;
  decision: { level: string; action: string; explanation: string; tags: string[] };
  result?: unknown;
  error?: string;
};

const normalizeToolAlias = (toolName: string, toolArgs: Record<string, unknown>) => {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return { toolName, toolArgs, aliasOf: undefined as string | undefined };
  }
  if (normalized === "ls" || normalized === "dir") {
    const pathArg =
      typeof toolArgs.path === "string"
        ? toolArgs.path
        : typeof toolArgs.cwd === "string"
          ? toolArgs.cwd
          : "";
    return { toolName: "list_dir", toolArgs: { path: pathArg }, aliasOf: toolName };
  }
  if (normalized === "pwd") {
    return { toolName: "pwd", toolArgs: {}, aliasOf: toolName };
  }
  if (normalized === "whoami") {
    return { toolName: "whoami", toolArgs: {}, aliasOf: toolName };
  }
  return { toolName, toolArgs, aliasOf: undefined as string | undefined };
};

const readJson = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

export const createServer = (
  config: ControllerConfig,
  gateway: GatewayClient,
  approvals: ApprovalManager,
) => {
  const defaultDataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "Projekt Aegis")
    : path.join(os.homedir(), ".projekt-aegis");
  const logPath =
    process.env.AEGIS_LOG_PATH ??
    path.join(defaultDataDir, "logs", "aegis_audit.jsonl");
  const maxMb = Number(process.env.AEGIS_LOG_MAX_MB ?? 50);
  const maxBytes = Number.isFinite(maxMb) && maxMb > 0 ? Math.floor(maxMb * 1024 * 1024) : undefined;
  const audit = new AuditLogger({ logPath, maxBytes });
  const metricsPath =
    process.env.AEGIS_METRICS_PATH ??
    path.join(defaultDataDir, "metrics.json");
  const metrics = new AlertMetrics(metricsPath);
  const workspaceRoot = process.env.AEGIS_WORKSPACE_DIR;
  let policyState: PolicyFileState = {
    enabled: ["1", "true", "yes", "on"].includes(
      String(process.env.AEGIS_POLICY_ENABLED ?? "false").toLowerCase(),
    ),
    path: process.env.AEGIS_POLICY_PATH,
    usingFile: false,
  };
  const resolvePolicyConfig = () => {
    const result = resolvePolicy(policyState);
    policyState = result.state;
    const policy = result.policy;
    if (workspaceRoot && (!policy.workspaceRoots || policy.workspaceRoots.length === 0)) {
      return { ...policy, workspaceRoots: [workspaceRoot] };
    }
    return policy;
  };
  const history: AuditEntry[] = [];

  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...metrics.snapshot(), logPath: audit.getLogPath() }));
      return;
    }

    if (req.method === "GET" && req.url === "/models") {
      try {
        const result = await gateway.request<{ models?: unknown[] }>("models.list", {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, models: result?.models ?? [] }));
        return;
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
        return;
      }
    }

    if (req.method === "GET" && req.url === "/policy") {
      const effective = resolvePolicyConfig();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          enabled: policyState.enabled,
          path: policyState.path ?? "",
          usingFile: policyState.usingFile,
          lastLoadedAt: policyState.lastLoadedAt,
          lastError: policyState.lastError,
          workspaceRoot: effective.workspaceRoots?.[0],
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/policy") {
      try {
        const body = (await readJson(req)) as { enabled?: boolean; path?: string };
        if (typeof body.enabled === "boolean") {
          policyState = { ...policyState, enabled: body.enabled };
        }
        if (typeof body.path === "string") {
          const trimmed = body.path.trim();
          policyState = { ...policyState, path: trimmed || undefined, mtimeMs: undefined };
        }
        policyState = { ...policyState, policy: undefined };
        resolvePolicyConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            enabled: policyState.enabled,
            path: policyState.path ?? "",
            usingFile: policyState.usingFile,
            lastLoadedAt: policyState.lastLoadedAt,
            lastError: policyState.lastError,
          }),
        );
        return;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
        return;
      }
    }

    if (req.method === "POST" && req.url === "/proxy") {
      try {
        const body = (await readJson(req)) as ProxyRequest;
        const requestId = body.requestId ?? randomUUID();
        const resolved = normalizeToolAlias(body.toolName, body.toolArgs ?? {});
        const toolRequest: ToolCallRequest = {
          requestId,
          timestamp: Date.now(),
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: resolved.toolName,
          toolArgs: resolved.toolArgs ?? {},
          context: body.context,
        };

        audit.append({
          type: "REQUEST",
          requestId,
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: resolved.toolName,
          payload: {
            toolArgs: resolved.toolArgs,
            context: body.context ?? {},
            originalTool: resolved.aliasOf ?? undefined,
          },
        });
        history.unshift({
          id: requestId,
          timestamp: new Date().toISOString(),
          type: "REQUEST",
          requestId,
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: resolved.toolName,
          payload: {
            toolArgs: resolved.toolArgs,
            context: body.context ?? {},
            originalTool: resolved.aliasOf ?? undefined,
          },
        });

        const decision = decideRisk(toolRequest, history, resolvePolicyConfig());
        metrics.bump(decision.level);
        audit.append({
          type: "DECISION",
          requestId,
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: body.toolName,
          payload: { decision },
        });
        history.unshift({
          id: `${requestId}-decision`,
          timestamp: new Date().toISOString(),
          type: "DECISION",
          requestId,
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: body.toolName,
          payload: { tags: decision.tags },
        });

        const execSessionKey = `agent:${config.execAgentId}:main`;
        const notify = async (message: string) => {
          await invokeTool({
            gatewayHttpUrl: config.gatewayHttpUrl,
            token: config.gatewayToken,
            tool: "sessions_send",
            sessionKey: execSessionKey,
            args: {
              sessionKey: body.sessionKey,
              message,
              timeoutSeconds: 0,
            },
          });
        };

        if (decision.level === "RED") {
          const approvalHandle = approvals.createApproval({
            toolName: resolved.toolName,
            agentId: body.agentId,
            sessionKey: body.sessionKey,
            reason: decision.explanation,
            commandSummary: `${resolved.toolName} ${JSON.stringify(resolved.toolArgs)}`,
          });

          await notify(
            `DANGER: Agent requested ${resolved.toolName} ${JSON.stringify(
              resolved.toolArgs,
            )}. Reply /approve ${approvalHandle.id} allow-once|allow-always|deny.`,
          );

          const approval = await approvalHandle.wait;

          audit.append({
            type: "USER_APPROVAL",
            requestId,
            agentId: body.agentId,
            sessionKey: body.sessionKey,
            toolName: body.toolName,
            payload: { decision: approval, approvalId: approvalHandle.id },
          });

          if (approval !== "allow-once" && approval !== "allow-always") {
            const response: ProxyResponse = {
              ok: false,
              decision,
              error: "BLOCKED_BY_USER",
            };
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }
        } else if (decision.level === "YELLOW") {
          await notify(
            `ALERT: Agent is performing ${resolved.toolName} ${JSON.stringify(
              resolved.toolArgs,
            )}. Reason: ${decision.explanation}`,
          );
        }

        let result: unknown;
        try {
          result = isLocalTool(resolved.toolName)
            ? await invokeLocalTool({
                toolName: resolved.toolName,
                toolArgs: resolved.toolArgs,
                workspaceRoot,
              })
            : await invokeTool({
                gatewayHttpUrl: config.gatewayHttpUrl,
                token: config.gatewayToken,
                tool: resolved.toolName,
                args: resolved.toolArgs,
                sessionKey: execSessionKey,
              });
        } catch (err) {
          metrics.bumpError();
          audit.append({
            type: "ERROR",
            requestId,
            agentId: body.agentId,
            sessionKey: execSessionKey,
            toolName: body.toolName,
            payload: { error: String(err) },
          });
          const response: ProxyResponse = {
            ok: false,
            decision,
            error: String(err),
          };
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        audit.append({
          type: "EXECUTION",
          requestId,
          agentId: body.agentId,
          sessionKey: execSessionKey,
          toolName: body.toolName,
          payload: { result },
        });

        const response: ProxyResponse = { ok: true, decision, result };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        return;
      } catch (err) {
        metrics.bumpError();
        audit.append({
          type: "ERROR",
          requestId: undefined,
          payload: { error: String(err) },
        });
        const response: ProxyResponse = {
          ok: false,
          decision: { level: "RED", action: "BLOCK", explanation: "Proxy error", tags: [] },
          error: String(err),
        };
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not Found" }));
  });
};
