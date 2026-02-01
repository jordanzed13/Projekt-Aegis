import type { AuditEvent, GuardrailDecision, ToolInvocationRequest } from '../types/index.js';
import type { SecurityPolicy } from '../config/index.js';

const NETWORK_TOOLS = new Set(['network_request', 'send_message', 'http_request']);

const isNetworkRequest = (req: ToolInvocationRequest): boolean => {
  if (NETWORK_TOOLS.has(req.toolName)) {
    return true;
  }

  if (req.toolName === 'run_shell') {
    const command = String(req.toolArgs.command ?? '');
    return command.includes('curl ') || command.includes('wget ');
  }

  return false;
};

const extractHostname = (req: ToolInvocationRequest): string | null => {
  if (req.toolName === 'run_shell') {
    const command = String(req.toolArgs.command ?? '');
    const match = command.match(/https?:\/\/[^\s]+/i);
    if (!match) {
      return null;
    }
    try {
      return new URL(match[0]).hostname;
    } catch {
      return null;
    }
  }

  const url = req.toolArgs.url ?? req.toolArgs.endpoint;
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const matchesSensitiveFile = (pathValue: string, patterns: string[]): boolean => {
  return patterns.some((pattern) => pathValue.includes(pattern));
};

const matchesSensitiveCommand = (command: string, patterns: string[]): boolean => {
  return patterns.some((pattern) => command.includes(pattern));
};

const countRecentRequests = (history: AuditEvent[], taskId: string, now: number): number => {
  return history.filter((event) => {
    if (event.type !== 'REQUEST' || event.taskId !== taskId) {
      return false;
    }
    if (event.payload?.event !== 'REQUEST_RECEIVED') {
      return false;
    }
    const timestamp = Number(event.payload?.timestamp ?? 0);
    return now - timestamp <= 60_000;
  }).length;
};

const countListDir = (history: AuditEvent[], taskId: string): number => {
  return history.filter((event) => {
    if (event.type !== 'REQUEST' || event.taskId !== taskId) {
      return false;
    }
    return event.payload?.toolName === 'list_dir';
  }).length;
};

const hasSensitiveAccess = (history: AuditEvent[], taskId: string): boolean => {
  return history.some((event) => {
    if (event.type !== 'DECISION' || event.taskId !== taskId) {
      return false;
    }
    return Array.isArray(event.payload?.riskTags)
      ? event.payload.riskTags.includes('sensitive_file')
      : false;
  });
};

export const decide = (
  req: ToolInvocationRequest,
  history: AuditEvent[],
  policy: SecurityPolicy
): GuardrailDecision => {
  const riskTags: string[] = [];

  if (req.toolName === 'read_file') {
    const targetPath = String(req.toolArgs.path ?? '');
    if (matchesSensitiveFile(targetPath, policy.sensitive_patterns.files)) {
      return {
        decision: 'RED',
        action: 'SUSPEND_AND_CONFIRM',
        riskTags: ['sensitive_file'],
        explanation: 'Deterministic block: sensitive file path detected.'
      };
    }
  }

  if (req.toolName === 'run_shell') {
    const command = String(req.toolArgs.command ?? '');
    if (matchesSensitiveCommand(command, policy.sensitive_patterns.commands)) {
      return {
        decision: 'RED',
        action: 'SUSPEND_AND_CONFIRM',
        riskTags: ['dangerous_command'],
        explanation: 'Deterministic block: dangerous shell command detected.'
      };
    }
  }

  if (isNetworkRequest(req)) {
    const hostname = extractHostname(req);
    if (hostname && !policy.allowed_domains.includes(hostname)) {
      return {
        decision: 'RED',
        action: 'SUSPEND_AND_CONFIRM',
        riskTags: ['network_exfiltration'],
        explanation: 'Deterministic block: outbound domain not allowed.'
      };
    }
  }

  if (countRecentRequests(history, req.taskId, req.timestamp) > policy.suspicious_thresholds.max_requests_per_minute) {
    riskTags.push('high_frequency');
  }

  if (req.toolName === 'list_dir' && countListDir(history, req.taskId) >= policy.suspicious_thresholds.max_dir_listings) {
    riskTags.push('enumeration');
  }

  if (req.toolName === 'read_file') {
    const targetPath = String(req.toolArgs.path ?? '');
    if (targetPath.includes('audit_log') || targetPath.includes('memory')) {
      riskTags.push('self_reflection');
    }
  }

  if (hasSensitiveAccess(history, req.taskId) && isNetworkRequest(req)) {
    return {
      decision: 'RED',
      action: 'SUSPEND_AND_CONFIRM',
      riskTags: ['behavior_chain'],
      explanation: 'Exfiltration risk: sensitive data accessed previously.'
    };
  }

  if (riskTags.length > 0) {
    return {
      decision: 'YELLOW',
      action: 'ALLOW_AND_NOTIFY',
      riskTags,
      explanation: 'Suspicious pattern detected; allow with notification.'
    };
  }

  return {
    decision: 'GREEN',
    action: 'ALLOW',
    riskTags: [],
    explanation: 'No policy violations detected.'
  };
};
