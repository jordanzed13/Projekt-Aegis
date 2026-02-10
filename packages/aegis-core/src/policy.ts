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
const DELETE_TOOLS = new Set(["delete", "delete_file", "remove", "remove_file", "unlink"]);
const EXEC_TOOLS = new Set(["run_shell", "exec"]);
// Lobster/workflow tools can execute multi-step pipelines (often including shell execution) as a single tool call.
// Until we have a Lobster-aware parser/enforcer, treat these as high-risk macro tools.
const HIGH_RISK_MACRO_TOOLS = new Set(["lobster", "workflow_tool"]);
const DELETE_COMMAND_WORDS = new Set(["rm", "del", "erase", "rmdir", "rd", "remove-item", "unlink"]);
const DANGEROUS_DELETE_PATTERNS = ["rm -rf", "del /s", "rmdir /s", "rd /s"];

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

const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, "");

const splitCommandTokens = (command: string) => {
  const firstSegment = command.split(/&&|\|\||\||;/)[0] ?? command;
  return firstSegment.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
};

const resolveCandidatePath = (candidate: string, workdir?: string): string => {
  if (!candidate) {
    return candidate;
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  if (workdir && path.isAbsolute(workdir)) {
    return path.resolve(workdir, candidate);
  }
  return candidate;
};

const findDeleteTargetInCommand = (command: string, workdir?: string): string | null => {
  const tokens = splitCommandTokens(command);
  if (tokens.length === 0) {
    return null;
  }
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const commandWord = stripQuotes(tokens[idx]).toLowerCase();
    if (!DELETE_COMMAND_WORDS.has(commandWord)) {
      continue;
    }
    const isWindowsDeleteWord =
      commandWord === "del" || commandWord === "erase" || commandWord === "rmdir" || commandWord === "rd";
    for (let argIdx = idx + 1; argIdx < tokens.length; argIdx += 1) {
      const arg = stripQuotes(tokens[argIdx]);
      if (!arg) {
        continue;
      }
      if (arg.startsWith("-")) {
        continue;
      }
      if (isWindowsDeleteWord && arg.startsWith("/")) {
        continue;
      }
      return resolveCandidatePath(arg, workdir);
    }
  }
  return null;
};

const isDeleteCommand = (command: string): boolean => {
  const normalized = normalizeValue(command);
  return Array.from(DELETE_COMMAND_WORDS).some((word) =>
    normalized.includes(`${normalizeValue(word)} `) || normalized.endsWith(normalizeValue(word)),
  );
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
  if (HIGH_RISK_MACRO_TOOLS.has(req.toolName)) {
    return {
      level: "RED",
      action: "BLOCK_PENDING_APPROVAL",
      tags: ["macro_tool"],
      explanation: `High-risk macro tool detected (${req.toolName}).`,
    };
  }

  const tags: string[] = [];
  const pathArg = extractPathArg(req);

  if (READ_TOOLS.has(req.toolName) || WRITE_TOOLS.has(req.toolName) || DELETE_TOOLS.has(req.toolName)) {
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
    if (DELETE_TOOLS.has(req.toolName) && pathArg && !isWithinRoots(pathArg, policy.workspaceRoots)) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["outside_workspace_delete"],
        explanation: "Delete attempt outside approved workspace.",
      };
    }
  }

  if (EXEC_TOOLS.has(req.toolName)) {
    const command = String(req.toolArgs.command ?? "");
    const workdir = typeof req.toolArgs.workdir === "string" ? req.toolArgs.workdir : undefined;
    const deleteCommand = isDeleteCommand(command);
    const deleteTarget = deleteCommand ? findDeleteTargetInCommand(command, workdir) : null;
    const workspaceDeleteAllowed = Boolean(deleteTarget && isWithinRoots(deleteTarget, policy.workspaceRoots));

    if (deleteCommand && !workspaceDeleteAllowed) {
      return {
        level: "RED",
        action: "BLOCK_PENDING_APPROVAL",
        tags: ["outside_workspace_delete"],
        explanation: "Delete intent outside approved workspace.",
      };
    }

    if (containsAny(command, policy.dangerousCommands)) {
      const dangerousDeleteOnly =
        workspaceDeleteAllowed && containsAny(command, DANGEROUS_DELETE_PATTERNS);
      if (dangerousDeleteOnly) {
        // workspace-local delete operations are allowed without extra prompts
      } else {
        return {
          level: "RED",
          action: "BLOCK_PENDING_APPROVAL",
          tags: ["dangerous_command"],
          explanation: "Dangerous command detected.",
        };
      }
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
