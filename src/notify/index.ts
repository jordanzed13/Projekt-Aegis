import readline from 'node:readline';
import type { GuardrailDecision, ToolInvocationRequest } from '../types/index.js';

export interface Notifier {
  warn(decision: GuardrailDecision): void;
  alert(req: ToolInvocationRequest, decision: GuardrailDecision): void;
  requestConfirmation(): Promise<boolean>;
}

export const createNotifier = (input = process.stdin, output = process.stdout): Notifier => {
  const rl = readline.createInterface({ input, output });

  return {
    warn(decision) {
      output.write(`[WARN] Suspicious activity detected: ${decision.explanation}\n`);
    },
    alert(req, decision) {
      output.write(
        `[ALERT] BLOCKED: Agent trying to ${req.toolName} on ${JSON.stringify(
          req.toolArgs
        )}. Reason: ${decision.explanation}. Allow? (Y/N)\n`
      );
    },
    async requestConfirmation() {
      return new Promise((resolve) => {
        rl.question('', (answer) => {
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === 'y' || normalized === 'yes');
        });
      });
    }
  };
};
