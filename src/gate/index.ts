import type { GuardrailDecision, ToolInvocationRequest, ExecutionResult } from '../types/index.js';
import type { Executor } from '../executor/index.js';
import type { AuditLogger } from '../audit/index.js';
import type { Notifier } from '../notify/index.js';

const suspensionQueue = new Map<string, ToolInvocationRequest>();

export const enforce = async (
  req: ToolInvocationRequest,
  decision: GuardrailDecision,
  executor: Executor,
  audit: AuditLogger,
  notifier: Notifier
): Promise<ExecutionResult> => {
  if (decision.decision === 'GREEN') {
    const result = executor.execute(req, decision);
    audit.append({
      type: 'EXECUTION',
      taskId: req.taskId,
      payload: { event: 'EXECUTION_RESULT', result }
    });
    return result;
  }

  if (decision.decision === 'YELLOW') {
    notifier.warn(decision);
    audit.append({
      type: 'USER_INTERACTION',
      taskId: req.taskId,
      payload: { event: 'WARNED', decision }
    });
    const result = executor.execute(req, decision);
    audit.append({
      type: 'EXECUTION',
      taskId: req.taskId,
      payload: { event: 'EXECUTION_RESULT', result }
    });
    return result;
  }

  suspensionQueue.set(req.requestId, req);
  notifier.alert(req, decision);
  audit.append({
    type: 'USER_INTERACTION',
    taskId: req.taskId,
    payload: { event: 'SUSPENDED', decision }
  });

  const approved = await notifier.requestConfirmation();
  if (!approved) {
    suspensionQueue.delete(req.requestId);
    const result: ExecutionResult = { status: 'blocked', error: 'BLOCKED_BY_USER' };
    audit.append({
      type: 'EXECUTION',
      taskId: req.taskId,
      payload: { event: 'BLOCKED_BY_USER', result }
    });
    return result;
  }

  suspensionQueue.delete(req.requestId);
  const result = executor.execute(req, decision);
  audit.append({
    type: 'EXECUTION',
    taskId: req.taskId,
    payload: { event: 'EXECUTION_RESULT', result }
  });
  return result;
};
