import type { ExecutionResult, GuardrailDecision, ToolInvocationRequest } from '../types/index.js';

export interface Executor {
  execute(req: ToolInvocationRequest, decision: GuardrailDecision): ExecutionResult;
}

export class MockExecutor implements Executor {
  execute(req: ToolInvocationRequest, decision: GuardrailDecision): ExecutionResult {
    if (decision.decision === 'RED') {
      return { status: 'blocked', error: 'Execution blocked by guardrail.' };
    }

    switch (req.toolName) {
      case 'read_file': {
        const targetPath = String(req.toolArgs.path ?? '');
        if (targetPath.includes('.ssh') || targetPath.includes('.aws')) {
          return { status: 'error', error: 'Access denied by executor.' };
        }
        return { status: 'success', output: `Dummy content of ${targetPath}` };
      }
      case 'run_shell': {
        const command = String(req.toolArgs.command ?? '');
        return { status: 'success', output: `MOCK SHELL: ${command}` };
      }
      case 'list_dir': {
        return { status: 'success', output: ['file_a.txt', 'file_b.txt'] };
      }
      default:
        return { status: 'success', output: { echoed: req.toolArgs } };
    }
  }
}
