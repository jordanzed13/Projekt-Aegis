import type { AuditEntry, PolicyConfig, PolicyDecision, ToolCallRequest } from "./types.js";

const NETWORK_TOOLS = new Set(["network_request", "send_message", "http_request", "web_request"]);

const containsAny = (value: string, patterns: string[]): boolean =>
  patterns.some((pattern) => value.includes(pattern));

const extractHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const isNetworkRequest = (req: ToolCallRequest): boolean => {
  if (NETWORK_TOOLS.has(req.toolName)) {
    return true;
  }
  if (req.toolName === "run_shell" || req.toolName === "exec") {
    const command = String(req.toolArgs.command ?? "");
    return command.includes("curl ") || command.includes("wget ") || command.includes("Invoke-WebRequest");
  }
  return false;
};

const hostnameFromRequest = (req: ToolCallRequest): string | null => {
  if (req.toolName === "run_shell" || req.toolName === "exec") {
    const command = String(req.toolArgs.command ?? "");
    const match = command.match(/https?:\/\/[^\s]+/i);
    return match ? extractHostname(match[0]) : null;
  }
  const url = req.toolArgs.url ?? req.toolArgs.endpoint;
  return typeof url === "string" ? extractHostname(url) : null;
};

const countRecentRequests = (history: AuditEntry[], sessionKey: string, now: number): number => {
  return history.filter((event) => {
    if (event.type !== "REQUEST") {
      return false;
    }
    if (event.sessionKey !== sessionKey) {
      return false;
    }
    const ts = Date.parse(event.timestamp);
    if (Number.isNaN(ts)) {
      return false;
    }
    return now - ts <= 60_000;
  }).length;
};

const countListDir = (history: AuditEntry[], sessionKey: string): number => {
  return history.filter((event) => {
    if (event.type !== "REQUEST") {
      return false;
    }
    return event.sessionKey === sessionKey && event.toolName === "list_dir";
  }).length;
};

const hasPriorSensitiveAccess = (history: AuditEntry[], sessionKey: string): boolean => {
  return history.some((event) => {
    if (event.type !== "DECISION") {
      return false;
    }
    const tags = event.payload.tags;
    if (!Array.isArray(tags)) {
      return false;
    }
    return event.sessionKey === sessionKey && tags.includes("sensitive_file");
  });
};

export const decideRisk = (
  req: ToolCallRequest,
  history: AuditEntry[],
  policy: PolicyConfig,
): PolicyDecision => {
  const tags: string[] = [];

  if (req.toolName === "read_file" || req.toolName === "read") {
    const targetPath = String(req.toolArgs.path ?? "");
    if (containsAny(targetPath, policy.sensitiveFiles)) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["sensitive_file"],
        explanation: "Sensitive file access detected.",
      };
    }
  }

  if (req.toolName === "run_shell" || req.toolName === "exec") {
    const command = String(req.toolArgs.command ?? "");
    if (containsAny(command, policy.dangerousCommands)) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["dangerous_command"],
        explanation: "Dangerous command detected.",
      };
    }
  }

  if (isNetworkRequest(req)) {
    const hostname = hostnameFromRequest(req);
    if (hostname && !policy.allowedDomains.includes(hostname)) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["network_exfiltration"],
        explanation: "Outbound domain not allowlisted.",
      };
    }
  }

  if (countRecentRequests(history, req.sessionKey, req.timestamp) > policy.suspiciousThresholds.maxRequestsPerMinute) {
    tags.push("high_frequency");
  }

  if (req.toolName === "list_dir" && countListDir(history, req.sessionKey) >= policy.suspiciousThresholds.maxDirListings) {
    tags.push("enumeration");
  }

  if (hasPriorSensitiveAccess(history, req.sessionKey) && isNetworkRequest(req)) {
    return {
      level: "RED",
      action: "BLOCK_PENDING_APPROVAL",
      tags: ["behavior_chain"],
      explanation: "Potential exfiltration after sensitive access.",
    };
  }

  if (tags.length > 0) {
    return {
      level: "YELLOW",
      action: "ALLOW_NOTIFY",
      tags,
      explanation: "Suspicious pattern detected; notifying user.",
    };
  }

  return {
    level: "GREEN",
    action: "ALLOW",
    tags: [],
    explanation: "No policy violations detected.",
  };
};

export const defaultPolicy: PolicyConfig = {
  sensitiveFiles: [".ssh/", ".aws/", ".env", "/etc/passwd", "passwords.txt", "System32"],
  dangerousCommands: ["rm -rf", "del /s", "format ", "powershell -enc", "| bash", "Invoke-Expression"],
  allowedDomains: ["openai.com", "anthropic.com", "github.com"],
  suspiciousThresholds: {
    maxRequestsPerMinute: 6,
    maxDirListings: 3,
  },
};
