import inquirer from 'inquirer';
import type { GuardrailDecision } from '../types/guardrail.js';

const red = (text: string): string => `\x1b[31m${text}\x1b[0m`;

export const askForConfirmation = async (decision: GuardrailDecision): Promise<boolean> => {
  console.log(red(`Risk: ${decision.explanation}`));
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Guardrail decision requires confirmation:',
      choices: ['Allow', 'Block']
    }
  ]);
  return choice === 'Allow';
};
