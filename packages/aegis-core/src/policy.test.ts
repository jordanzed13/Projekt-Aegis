import { describe, expect, it } from "vitest";
import { decideRisk, defaultPolicy } from "./policy.js";
import type { AuditEntry, ToolCallRequest } from "./types.js";

const baseReq: ToolCallRequest = {
  requestId: "req-1",
  timestamp: Date.now(),
  agentId: "main",
  sessionKey: "agent:main:main",
  toolName: "read",
  toolArgs: { path: "C:/Users/User/Documents/test.txt" },
  context: { agentReason: "testing" },
};

const history: AuditEntry[] = [];

describe("decideRisk", () => {
  it("flags sensitive files as RED", () => {
    const decision = decideRisk(
      {
        ...baseReq,
        toolName: "read",
        toolArgs: { path: "C:/Users/User/.ssh/id_rsa" },
      },
      history,
      defaultPolicy,
    );
    expect(decision.level).toBe("RED");
    expect(decision.tags).toContain("sensitive_file");
  });

  it("flags high-frequency activity as YELLOW", () => {
    const now = Date.now();
    const frequentHistory: AuditEntry[] = Array.from({ length: 7 }).map((_, idx) => ({
      id: `h-${idx}`,
      timestamp: new Date(now - 1000 * idx).toISOString(),
      type: "REQUEST",
      requestId: `req-${idx}`,
      agentId: "main",
      sessionKey: "agent:main:main",
      toolName: "list_dir",
      payload: {},
    }));

    const decision = decideRisk(
      { ...baseReq, toolName: "list_dir", toolArgs: { path: "C:/" } },
      frequentHistory,
      defaultPolicy,
    );
    expect(decision.level).toBe("YELLOW");
  });
});
