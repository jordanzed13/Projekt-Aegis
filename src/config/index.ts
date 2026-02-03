import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface SecurityPolicy {
  sensitive_patterns: {
    files: string[];
    commands: string[];
  };
  suspicious_thresholds: {
    max_requests_per_minute: number;
    max_dir_listings: number;
  };
  allowed_domains: string[];
}

export interface PolicyConfig {
  security_policy: SecurityPolicy;
}

export const loadPolicy = (policyPath = path.join('config', 'policy.yaml')): SecurityPolicy => {
  const raw = fs.readFileSync(policyPath, 'utf8');
  const parsed = yaml.load(raw) as PolicyConfig;
  return parsed.security_policy;
};
