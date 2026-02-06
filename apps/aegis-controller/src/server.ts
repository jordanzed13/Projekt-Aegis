import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AuditLogger, decideRisk, defaultPolicy, type AuditEntry, type ToolCallRequest } from "@aegis/core";
import type { GatewayClient } from "./gateway-client.js";
import type { ApprovalManager } from "./approvals.js";
import { invokeTool } from "./tool-invoke.js";
import type { ControllerConfig } from "./config.js";

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
  _gateway: GatewayClient,
  approvals: ApprovalManager,
) => {
  const logPath =
    process.env.AEGIS_LOG_PATH ??
    path.join(os.homedir(), ".projekt-aegis", "logs", "aegis_audit_log.jsonl");
  const audit = new AuditLogger({ logPath });
  const policy = defaultPolicy;
  const history: AuditEntry[] = [];

  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/proxy") {
      try {
        const body = (await readJson(req)) as ProxyRequest;
        const requestId = body.requestId ?? randomUUID();
        const toolRequest: ToolCallRequest = {
          requestId,
          timestamp: Date.now(),
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: body.toolName,
          toolArgs: body.toolArgs ?? {},
          context: body.context,
        };

        audit.append({
          type: "REQUEST",
          requestId,
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: body.toolName,
          payload: { toolArgs: body.toolArgs, context: body.context ?? {} },
        });
        history.unshift({
          id: requestId,
          timestamp: new Date().toISOString(),
          type: "REQUEST",
          requestId,
          agentId: body.agentId,
          sessionKey: body.sessionKey,
          toolName: body.toolName,
          payload: { toolArgs: body.toolArgs, context: body.context ?? {} },
        });

        const decision = decideRisk(toolRequest, history, policy);
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
            toolName: body.toolName,
            agentId: body.agentId,
            sessionKey: body.sessionKey,
            reason: decision.explanation,
            commandSummary: `${body.toolName} ${JSON.stringify(body.toolArgs)}`,
          });

          await notify(
            `DANGER: Agent requested ${body.toolName} ${JSON.stringify(
              body.toolArgs,
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
            `ALERT: Agent is performing ${body.toolName} ${JSON.stringify(
              body.toolArgs,
            )}. Reason: ${decision.explanation}`,
          );
        }

        const result = await invokeTool({
          gatewayHttpUrl: config.gatewayHttpUrl,
          token: config.gatewayToken,
          tool: body.toolName,
          args: body.toolArgs,
          sessionKey: execSessionKey,
        });

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
