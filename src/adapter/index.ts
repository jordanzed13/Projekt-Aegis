import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolInvocationRequest } from '../types/index.js';

const requestSchema = z.object({
  agentId: z.string().min(1),
  taskId: z.string().min(1),
  toolName: z.string().min(1),
  toolArgs: z.record(z.any()).default({}),
  context: z.record(z.any()).default({})
});

export const adaptRequest = (rawInput: unknown): ToolInvocationRequest => {
  const parsed = requestSchema.parse(rawInput);
  return {
    requestId: randomUUID(),
    timestamp: Date.now(),
    agentId: parsed.agentId,
    taskId: parsed.taskId,
    toolName: parsed.toolName,
    toolArgs: parsed.toolArgs,
    context: parsed.context
  };
};

export const readJsonFromStdin = async (): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
};
