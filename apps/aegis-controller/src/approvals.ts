import { randomUUID } from "node:crypto";
import type { GatewayClient } from "./gateway-client.js";

export type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export type ApprovalRequest = {
  toolName: string;
  agentId: string;
  sessionKey: string;
  reason: string;
  commandSummary: string;
};

type Pending = {
  resolve: (decision: ApprovalDecision) => void;
  reject: (err: Error) => void;
};

export type ApprovalHandle = {
  id: string;
  wait: Promise<ApprovalDecision>;
};

export class ApprovalManager {
  private pending = new Map<string, Pending>();
  private gateway: GatewayClient;

  constructor(gateway: GatewayClient) {
    this.gateway = gateway;
  }

  handleEvent(evt: { event: string; payload?: unknown }) {
    if (evt.event !== "exec.approval.resolved") {
      return;
    }
    const payload = evt.payload as { id?: string; decision?: ApprovalDecision } | undefined;
    if (!payload?.id || !payload.decision) {
      return;
    }
    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }
    this.pending.delete(payload.id);
    pending.resolve(payload.decision);
  }

  createApproval(request: ApprovalRequest): ApprovalHandle {
    const id = `aegis-${randomUUID()}`;

    void this.gateway
      .request("exec.approval.request", {
        id,
        command: request.commandSummary,
        agentId: request.agentId,
        sessionKey: request.sessionKey,
        ask: "always",
        security: "allowlist",
      })
      .catch((err) => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      });

    const wait = new Promise<ApprovalDecision>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error("approval timeout"));
      }, 120_000);
    });

    return { id, wait };
  }
}
