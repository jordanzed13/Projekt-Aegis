import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { defaultPolicy, type PolicyConfig } from "@aegis/core";

export type PolicyFileState = {
  enabled: boolean;
  path?: string;
  usingFile: boolean;
  lastLoadedAt?: string;
  lastError?: string;
  mtimeMs?: number;
  policy?: PolicyConfig;
};

type RawPolicy = Record<string, unknown>;

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry) => typeof entry === "string").map((entry) => entry.trim());
  return items.length > 0 ? items : undefined;
};

const normalizeStringArrayOrEmpty = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry) => typeof entry === "string").map((entry) => entry.trim());
};

const normalizeThresholds = (value: unknown): PolicyConfig["suspiciousThresholds"] | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const maxRequestsPerMinute =
    typeof record.maxRequestsPerMinute === "number" ? record.maxRequestsPerMinute : undefined;
  const maxDirListings =
    typeof record.maxDirListings === "number" ? record.maxDirListings : undefined;
  if (maxRequestsPerMinute === undefined && maxDirListings === undefined) {
    return undefined;
  }
  return {
    maxRequestsPerMinute: maxRequestsPerMinute ?? defaultPolicy.suspiciousThresholds.maxRequestsPerMinute,
    maxDirListings: maxDirListings ?? defaultPolicy.suspiciousThresholds.maxDirListings,
  };
};

const sanitizePolicyConfig = (raw: RawPolicy): Partial<PolicyConfig> => {
  const source = (raw.policy && typeof raw.policy === "object" ? (raw.policy as RawPolicy) : raw) ?? {};
  return {
    sensitiveFiles: normalizeStringArray(source.sensitiveFiles),
    dangerousCommands: normalizeStringArray(source.dangerousCommands),
    blockedEnvKeys: normalizeStringArray(source.blockedEnvKeys),
    blockedEnvPrefixes: normalizeStringArray(source.blockedEnvPrefixes),
    sensitiveEnvKeys: normalizeStringArray(source.sensitiveEnvKeys),
    workspaceRoots: normalizeStringArrayOrEmpty(source.workspaceRoots),
    allowedDomains: normalizeStringArray(source.allowedDomains),
    suspiciousThresholds: normalizeThresholds(source.suspiciousThresholds),
  };
};

const mergePolicy = (partial: Partial<PolicyConfig>): PolicyConfig => ({
  ...defaultPolicy,
  ...partial,
  suspiciousThresholds: {
    ...defaultPolicy.suspiciousThresholds,
    ...(partial.suspiciousThresholds ?? {}),
  },
});

const parsePolicyFile = (filePath: string, raw: string): RawPolicy => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    const parsed = yaml.parse(raw) as RawPolicy;
    return parsed ?? {};
  }
  return JSON.parse(raw) as RawPolicy;
};

export const loadPolicyFromFile = (state: PolicyFileState): PolicyFileState => {
  if (!state.enabled || !state.path) {
    return { ...state, usingFile: false, lastError: undefined, policy: undefined };
  }
  try {
    const stats = fs.statSync(state.path);
    if (state.mtimeMs && state.policy && stats.mtimeMs === state.mtimeMs) {
      return { ...state, usingFile: true };
    }
    const raw = fs.readFileSync(state.path, "utf8");
    const parsed = parsePolicyFile(state.path, raw);
    const partial = sanitizePolicyConfig(parsed);
    const merged = mergePolicy(partial);
    return {
      ...state,
      usingFile: true,
      policy: merged,
      lastLoadedAt: new Date().toISOString(),
      lastError: undefined,
      mtimeMs: stats.mtimeMs,
    };
  } catch (err) {
    return {
      ...state,
      usingFile: false,
      policy: undefined,
      lastError: err instanceof Error ? err.message : String(err),
    };
  }
};

export const resolvePolicy = (state: PolicyFileState) => {
  const next = loadPolicyFromFile(state);
  return {
    state: next,
    policy: next.policy ?? defaultPolicy,
  };
};
