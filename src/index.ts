import { adaptRequest } from './adapter/index.js';
import { AuditLogger } from './audit/index.js';
import { loadPolicy } from './config/index.js';
import { decide } from './guardrail/index.js';
import { enforce } from './gate/index.js';
import { MockExecutor } from './executor/index.js';
import { createNotifier } from './notify/index.js';
import type { ToolInvocationRequest } from './types/index.js';

export const runRequest = async (rawInput: unknown, history: ToolInvocationRequest[] = []) => {
  const policy = loadPolicy();
  const audit = new AuditLogger();
  const executor = new MockExecutor();
  const notifier = createNotifier();

  const request = adaptRequest(rawInput);
  audit.append({
    type: 'REQUEST',
    taskId: request.taskId,
    payload: {
      event: 'REQUEST_RECEIVED',
      timestamp: request.timestamp,
      toolName: request.toolName,
      toolArgs: request.toolArgs
    }
  });

  for (const prior of history) {
    audit.append({
      type: 'REQUEST',
      taskId: prior.taskId,
      payload: {
        event: 'REQUEST_RECEIVED',
        timestamp: prior.timestamp,
        toolName: prior.toolName,
        toolArgs: prior.toolArgs
      }
    });
  }

  const decision = decide(request, audit.getEvents(), policy);
  audit.append({
    type: 'DECISION',
    taskId: request.taskId,
    payload: { event: 'DECISION_MADE', decision, riskTags: decision.riskTags }
  });

  const result = await enforce(request, decision, executor, audit, notifier);
  return { request, decision, result };
};
