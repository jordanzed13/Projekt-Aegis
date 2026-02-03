import { randomUUID } from 'node:crypto';
import type { ToolRequest } from '../types/guardrail.js';
import type { PolicyConfig } from '../config/loader.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import { evaluateRequest } from '../guardrail/engine.js';
import { auditLogger } from '../audit/logger.js';
import { askForConfirmation } from '../notify/cli.js';

const toToolRequest = (tool: any, input: Record<string, unknown>): ToolRequest => ({
  toolName: tool?.name ?? tool?.toolName ?? 'unknown_tool',
  args: input,
  agentId: typeof input.agentId === 'string' ? input.agentId : 'unknown_agent',
  requestId: randomUUID()
});

const needsConfirmation = (decision: GuardrailDecision): boolean =>
  decision.decision === 'RED' || decision.decision === 'YELLOW';

export const applyGuardrail = (originalTool: any, policy: PolicyConfig): any => {
  return {
    ...originalTool,
    async execute(input: Record<string, unknown>) {
      const request = toToolRequest(originalTool, input);
      const decision = evaluateRequest(request, policy);

      if (needsConfirmation(decision)) {
        auditLogger.info({
          event: 'GUARDRAIL_REVIEW',
          request,
          decision
        });
        const allowed = await askForConfirmation(decision);
        if (!allowed) {
          throw new Error('Action Blocked by Guardrail');
        }
      }

      return originalTool.execute(input);
    }
  };
};
