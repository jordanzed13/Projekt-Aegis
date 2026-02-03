import type { GuardrailDecision, ToolRequest } from '../types/guardrail.js';
import type { PolicyConfig } from '../config/loader.js';

const RED_RESPONSE: GuardrailDecision = {
  decision: 'RED',
  riskTags: ['policy_violation'],
  explanation: 'Request violates deterministic guardrail rules.'
};

const GREEN_RESPONSE: GuardrailDecision = {
  decision: 'GREEN',
  riskTags: [],
  explanation: 'Request allowed by deterministic policy.'
};

const hasBlockedCommand = (command: string, blocked: string[]): boolean =>
  blocked.some((pattern) => command.includes(pattern));

const hasSensitiveFile = (pathValue: string, sensitive: string[]): boolean =>
  sensitive.some((pattern) => pathValue.includes(pattern));

export const evaluateRequest = (req: ToolRequest, policy: PolicyConfig): GuardrailDecision => {
  if (req.toolName === 'run_shell') {
    const command = String(req.args.command ?? '');
    if (hasBlockedCommand(command, policy.blocked_commands)) {
      return {
        ...RED_RESPONSE,
        riskTags: ['blocked_command'],
        explanation: 'Red line: blocked shell command detected.'
      };
    }
  }

  if (req.toolName === 'read_file') {
    const targetPath = String(req.args.path ?? '');
    if (hasSensitiveFile(targetPath, policy.sensitive_files)) {
      return {
        ...RED_RESPONSE,
        riskTags: ['sensitive_file'],
        explanation: 'Red line: sensitive file access detected.'
      };
    }
  }

  return GREEN_RESPONSE;
};
