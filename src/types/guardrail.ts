export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';

export interface GuardrailDecision {
  decision: RiskLevel;
  riskTags: string[];
  explanation: string;
}

export interface ToolRequest {
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  requestId: string;
}
