import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface PolicyConfig {
  blocked_commands: string[];
  sensitive_files: string[];
}

export const loadPolicy = (policyPath = path.join('config', 'policy.yaml')): PolicyConfig => {
  const raw = fs.readFileSync(policyPath, 'utf8');
  const parsed = yaml.load(raw) as PolicyConfig;
  return {
    blocked_commands: parsed.blocked_commands ?? [],
    sensitive_files: parsed.sensitive_files ?? []
  };
};
