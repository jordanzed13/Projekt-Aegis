export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';
export type DecisionAction =
  | 'ALLOW'
  | 'ALLOW_AND_NOTIFY'
  | 'SUSPEND_AND_CONFIRM'
  | 'DENY';

export interface ToolInvocationRequest {
  requestId: string;
  timestamp: number;
  agentId: string;
  taskId: string;
  toolName: string;
  toolArgs: Record<string, any>;
  context: {
    agentReason?: string;
    [key: string]: any;
  };
}

export interface GuardrailDecision {
  decision: RiskLevel;
  action: DecisionAction;
  riskTags: string[];
  explanation: string;
}

export interface ExecutionResult {
  status: 'success' | 'error' | 'blocked' | 'pending_confirmation';
  output?: any;
  error?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: 'REQUEST' | 'DECISION' | 'EXECUTION' | 'USER_INTERACTION';
  taskId: string;
  payload: any;
}
