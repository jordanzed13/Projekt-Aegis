import path from "node:path";
import type { AuditEntry, PolicyConfig, PolicyDecision, ToolCallRequest } from "./types.js";

const NETWORK_TOOLS = new Set([
  "network_request",
  "send_message",
  "http_request",
  "web_request",
  "web_fetch",
  "web_search",
]);
const READ_TOOLS = new Set(["read", "read_file"]);
const WRITE_TOOLS = new Set(["write", "write_file", "edit", "edit_file"]);
const EXEC_TOOLS = new Set(["run_shell", "exec"]);

const normalizeValue = (value: string): string => value.toLowerCase();

const containsAny = (value: string, patterns: string[]): boolean => {
  const normalized = normalizeValue(value);
  return patterns.some((pattern) => normalized.includes(normalizeValue(pattern)));
};

const extractPathArg = (req: ToolCallRequest): string | null => {
  const args = req.toolArgs ?? {};
  const raw = args.path ?? args.file_path;
  return typeof raw === "string" ? raw : null;
};

const extractExecEnv = (req: ToolCallRequest): Record<string, string> | null => {
  if (!EXEC_TOOLS.has(req.toolName)) {
    return null;
  }
  const env = req.toolArgs.env;
  if (!env || typeof env !== "object") {
    return null;
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
};

const isWithinRoots = (candidate: string | null, roots: string[]): boolean => {
  if (!candidate || roots.length === 0) {
    return false;
  }
  if (!path.isAbsolute(candidate)) {
    return true;
  }
  const resolvedCandidate = path.resolve(candidate);
  return roots.some((root) => {
    if (!root) {
      return false;
    }
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
};

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
  if (EXEC_TOOLS.has(req.toolName)) {
    const command = String(req.toolArgs.command ?? "");
    return command.includes("curl ") || command.includes("wget ") || command.includes("Invoke-WebRequest");
  }
  return false;
};

const hostnameFromRequest = (req: ToolCallRequest): string | null => {
  if (EXEC_TOOLS.has(req.toolName)) {
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

const isAllowedDomain = (hostname: string, allowedDomains: string[]): boolean => {
  const normalized = normalizeValue(hostname);
  return allowedDomains.some((domain) => {
    const allowed = normalizeValue(domain);
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
};

export const decideRisk = (
  req: ToolCallRequest,
  history: AuditEntry[],
  policy: PolicyConfig,
): PolicyDecision => {
  const tags: string[] = [];
  const pathArg = extractPathArg(req);

  if (READ_TOOLS.has(req.toolName) || WRITE_TOOLS.has(req.toolName)) {
    const targetPath = String(pathArg ?? "");
    if (targetPath && containsAny(targetPath, policy.sensitiveFiles)) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["sensitive_file"],
        explanation: "Sensitive file access detected.",
      };
    }
    if (WRITE_TOOLS.has(req.toolName) && pathArg && !isWithinRoots(pathArg, policy.workspaceRoots)) {
      tags.push("outside_workspace_write");
    }
  }

  if (EXEC_TOOLS.has(req.toolName)) {
    const command = String(req.toolArgs.command ?? "");
    if (containsAny(command, policy.dangerousCommands)) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["dangerous_command"],
        explanation: "Dangerous command detected.",
      };
    }
    const env = extractExecEnv(req);
    if (env) {
      const blockedKeys = policy.blockedEnvKeys.map((key) => key.toUpperCase());
      const blockedPrefixes = policy.blockedEnvPrefixes.map((key) => key.toUpperCase());
      const sensitiveKeys = policy.sensitiveEnvKeys.map((key) => key.toUpperCase());
      for (const key of Object.keys(env)) {
        const upper = key.toUpperCase();
        if (blockedKeys.includes(upper) || blockedPrefixes.some((prefix) => upper.startsWith(prefix))) {
          return {
            level: "RED",
            action: "BLOCK_PENDING_APPROVAL",
            tags: ["dangerous_env"],
            explanation: "Execution environment contains blocked variables.",
          };
        }
        if (sensitiveKeys.some((pattern) => upper.includes(pattern))) {
          tags.push("sensitive_env");
        }
      }
    }
    const workdir = req.toolArgs.workdir;
    if (typeof workdir === "string" && workdir && !isWithinRoots(workdir, policy.workspaceRoots)) {
      tags.push("exec_outside_workspace");
    }
  }

  if (isNetworkRequest(req)) {
    const hostname = hostnameFromRequest(req);
    if (hostname && !isAllowedDomain(hostname, policy.allowedDomains)) {
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
  sensitiveFiles: [
    ".ssh/",
    ".aws/",
    ".env",
    ".env.",
    ".npmrc",
    ".git-credentials",
    ".git/config",
    "id_rsa",
    "id_ed25519",
    "credentials",
    "secrets",
    "System32",
    "Windows\\System32",
    "AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
  ],
  dangerousCommands: [
    "rm -rf",
    "del /s",
    "rmdir /s",
    "rd /s",
    "format ",
    "diskpart",
    "bcdedit",
    "vssadmin delete",
    "reg add",
    "reg delete",
    "regedit",
    "schtasks",
    "sc ",
    "net user",
    "net localgroup",
    "takeown",
    "icacls /grant",
    "powershell -enc",
    "powershell -encodedcommand",
    "Invoke-Expression",
    "| bash",
    "curl | sh",
    "wget | sh",
  ],
  blockedEnvKeys: [
    "PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "RUBYLIB",
    "PERL5LIB",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "BASH_ENV",
    "ENV",
  ],
  blockedEnvPrefixes: ["LD_", "DYLD_"],
  sensitiveEnvKeys: ["KEY", "TOKEN", "SECRET", "PASSWORD", "PRIVATE"],
  workspaceRoots: [],
  allowedDomains: ["openai.com", "anthropic.com", "openrouter.ai", "googleapis.com", "github.com"],
  suspiciousThresholds: {
    maxRequestsPerMinute: 6,
    maxDirListings: 3,
  },
};
