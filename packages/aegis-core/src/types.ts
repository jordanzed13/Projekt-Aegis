export type RiskLevel = "GREEN" | "YELLOW" | "RED";

export type DecisionAction =
  | "ALLOW"
  | "ALLOW_NOTIFY"
  | "BLOCK_PENDING_APPROVAL"
  | "BLOCK";

export type ToolCallContext = {
  agentReason?: string;
  messageChannel?: string;
  [key: string]: unknown;
};

export type ToolCallRequest = {
  requestId: string;
  timestamp: number;
  agentId: string;
  sessionKey: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  context?: ToolCallContext;
};

export type PolicyDecision = {
  level: RiskLevel;
  action: DecisionAction;
  tags: string[];
  explanation: string;
};

export type PolicyConfig = {
  sensitiveFiles: string[];
  dangerousCommands: string[];
  allowedDomains: string[];
  suspiciousThresholds: {
    maxRequestsPerMinute: number;
    maxDirListings: number;
  };
};

export type AuditEventType =
  | "REQUEST"
  | "DECISION"
  | "EXECUTION"
  | "USER_ALERT"
  | "USER_APPROVAL";

export type AuditEntry = {
  id: string;
  timestamp: string;
  type: AuditEventType;
  requestId?: string;
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  payload: Record<string, unknown>;
};
