import { loadPolicy } from './config/loader.js';
import { applyGuardrail } from './middleware/moltbot.js';

class ShellTool {
  name = 'run_shell';

  async execute(input: { command: string }) {
    return `Executed: ${input.command}`;
  }
}

const run = async () => {
  const policy = loadPolicy();
  const guardedTool = applyGuardrail(new ShellTool(), policy);

  console.log(await guardedTool.execute({ command: 'ls -la', agentId: 'agent-1' }));
  console.log(await guardedTool.execute({ command: 'rm -rf /', agentId: 'agent-1' }));
};

run().catch((error) => {
  console.error('Execution failed:', error.message);
  process.exit(1);
});
