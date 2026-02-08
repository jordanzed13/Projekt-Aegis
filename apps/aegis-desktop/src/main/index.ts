import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type AegisSettings = {
  onboardingComplete: boolean;
  gatewayToken?: string;
  provider?: string;
  model?: string;
  communication?: "web" | "messaging";
  policyFileEnabled?: boolean;
  policyFilePath?: string;
  runtimeInstallMethod?: "git" | "npm";
  runtimeInstalledAt?: string;
  runtimeInstalledPath?: string;
};

type AegisSetupStatus = {
  onboardingComplete: boolean;
  gatewayToken: string;
  provider?: string;
  model?: string;
  communication?: "web" | "messaging";
  dashboardUrl?: string;
};

type OnboardRequest = {
  acceptRisk: boolean;
  provider: string;
  apiKey?: string;
  model?: string;
  gatewayToken?: string;
  communication?: "web" | "messaging";
};

type UpdateProviderRequest = {
  provider: string;
  apiKey?: string;
  model?: string;
};

type PolicySettings = {
  enabled: boolean;
  path: string;
};

type PolicyStatus = PolicySettings & {
  ok: boolean;
  usingFile: boolean;
  lastLoadedAt?: string;
  lastError?: string;
  workspaceRoot?: string;
};

type AegisRuntimeStatus = {
  installed: boolean;
  path: string;
  downloading: boolean;
  lastError?: string;
  method?: "git" | "npm";
  installedAt?: string;
};

type AegisRuntimeInstallRequest = {
  method?: "git" | "npm";
};

type OpenClawLaunchTarget =
  | { mode: "entry"; entry: string }
  | { mode: "cmd"; cmd: string }
  | { mode: "none"; error: string };

type AegisProgressStatus = {
  active: boolean;
  task?: "runtime" | "onboard" | "assets";
  message?: string;
  value?: number;
};

type MigrationReport = {
  migrated: boolean;
  entries: string[];
  from: string;
  to: string;
  reason?: string;
  error?: string;
};

let mainWindow: BrowserWindow | null = null;
let openclawProcess: ChildProcessWithoutNullStreams | null = null;
let controllerProcess: ChildProcessWithoutNullStreams | null = null;
let assetsDownloadProcess: ChildProcessWithoutNullStreams | null = null;
let runtimeInstallProcess: ChildProcessWithoutNullStreams | null = null;
let gatewayToken = "";
let gatewayPort = 18789;
let controllerPort = 18799;
let assetsLastError: string | null = null;
let runtimeDownloading = false;
let runtimeLastError: string | null = null;
let progressStatus: AegisProgressStatus = { active: false };
let progressClearTimer: NodeJS.Timeout | null = null;
let settings: AegisSettings = { onboardingComplete: false };

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

const getRepoRoot = () => process.cwd();

const resolveAegisDataDir = () => path.join(app.getPath("appData"), "Projekt Aegis");
const resolveRoamingDir = () => app.getPath("appData");

const resolveSettingsPath = () =>
  path.join(resolveAegisDataDir(), "aegis-settings.json");

const loadSettings = async (): Promise<AegisSettings> => {
  try {
    const raw = await fs.readFile(resolveSettingsPath(), "utf8");
    const parsed = JSON.parse(raw) as AegisSettings;
    return {
      onboardingComplete: Boolean(parsed.onboardingComplete),
      gatewayToken: parsed.gatewayToken,
      provider: parsed.provider,
      model: parsed.model,
      communication: parsed.communication,
      policyFileEnabled: parsed.policyFileEnabled,
      policyFilePath: parsed.policyFilePath,
      runtimeInstallMethod:
        parsed.runtimeInstallMethod === "git" || parsed.runtimeInstallMethod === "npm"
          ? parsed.runtimeInstallMethod
          : undefined,
      runtimeInstalledAt: parsed.runtimeInstalledAt,
      runtimeInstalledPath:
        typeof parsed.runtimeInstalledPath === "string" ? parsed.runtimeInstalledPath : undefined,
    };
  } catch {
    return { onboardingComplete: false };
  }
};

const saveSettings = async (next: AegisSettings) => {
  settings = { ...settings, ...next };
  await fs.mkdir(path.dirname(resolveSettingsPath()), { recursive: true });
  await fs.writeFile(resolveSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
};

const resolveOpenClawConfigPath = () => path.join(resolveAegisDataDir(), "openclaw.json");
const resolveOpenClawStateDir = () => path.join(resolveAegisDataDir(), "openclaw-state");
const resolveWorkspaceDir = () => path.join(resolveAegisDataDir(), "workspace");
const resolveAegisLogsDir = () => path.join(resolveAegisDataDir(), "logs");
const resolveManagedRuntimePrefix = () => path.join(resolveAegisDataDir(), "runtime", "npm-global");
const resolveManagedOpenClawRoot = () =>
  path.join(resolveManagedRuntimePrefix(), "node_modules", "openclaw");
const resolveRuntimeRoot = () => path.join(resolveAegisDataDir(), "runtime", "openclaw");
const resolveBundledOpenClawRoot = () => path.join(process.resourcesPath, "openclaw");
const padNumber = (value: number, size = 2) => String(value).padStart(size, "0");
const formatLogTimestamp = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = padNumber(date.getUTCMonth() + 1);
  const day = padNumber(date.getUTCDate());
  const hours = padNumber(date.getUTCHours());
  const minutes = padNumber(date.getUTCMinutes());
  const seconds = padNumber(date.getUTCSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};
const buildLogFileName = (timestamp: string) => `aegis_audit_${timestamp}.jsonl`;
let sessionLogPath: string | null = null;
const ensureSessionLogFile = async () => {
  if (!sessionLogPath) {
    sessionLogPath = path.join(resolveAegisLogsDir(), buildLogFileName(formatLogTimestamp()));
  }
  await fs.mkdir(resolveAegisLogsDir(), { recursive: true });
  try {
    await fs.access(sessionLogPath);
  } catch {
    await fs.writeFile(sessionLogPath, "");
  }
  return sessionLogPath;
};
const resolveAegisMetricsPath = () => path.join(resolveAegisDataDir(), "metrics.json");
const resolvePolicyFilePath = () => path.join(resolveAegisDataDir(), "policy.json");
const resolveAuthProfilesPath = (agentId = "main") =>
  path.join(resolveOpenClawStateDir(), "agents", agentId, "agent", "auth-profiles.json");

const resolveLegacyUserDataDir = () => app.getPath("userData");

const pathExists = async (target: string) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const isDirEmpty = async (target: string) => {
  try {
    const entries = await fs.readdir(target);
    return entries.length === 0;
  } catch {
    return true;
  }
};

const migrateLegacyUserData = async (): Promise<MigrationReport> => {
  const legacyDir = resolveLegacyUserDataDir();
  const nextDir = resolveAegisDataDir();
  const legacyNormalized = path.resolve(legacyDir).toLowerCase();
  const nextNormalized = path.resolve(nextDir).toLowerCase();
  if (legacyNormalized === nextNormalized) {
    return { migrated: false, entries: [], from: legacyDir, to: nextDir, reason: "same_path" };
  }
  if (!(await pathExists(legacyDir))) {
    return { migrated: false, entries: [], from: legacyDir, to: nextDir, reason: "legacy_missing" };
  }
  if (!(await isDirEmpty(nextDir))) {
    return {
      migrated: false,
      entries: [],
      from: legacyDir,
      to: nextDir,
      reason: "target_not_empty",
    };
  }

  const migrated: string[] = [];
  const entries = [
    "aegis-settings.json",
    "openclaw.json",
    "openclaw-state",
    "workspace",
    "assets",
    "logs",
    "metrics.json",
  ];
  try {
    await fs.mkdir(nextDir, { recursive: true });
    for (const entry of entries) {
      const src = path.join(legacyDir, entry);
      const dest = path.join(nextDir, entry);
      if (!(await pathExists(src)) || (await pathExists(dest))) {
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(src, dest, { recursive: true });
      migrated.push(entry);
    }
    return { migrated: migrated.length > 0, entries: migrated, from: legacyDir, to: nextDir };
  } catch (err) {
    return {
      migrated: false,
      entries: migrated,
      from: legacyDir,
      to: nextDir,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const policyTemplate = {
  sensitiveFiles: [
    ".ssh/",
    ".aws/",
    ".env",
    ".env.",
    ".npmrc",
    ".git-credentials",
    ".git/config",
    "id_rsa",
    "id_ed25519",
    "credentials",
    "secrets",
    "System32",
    "Windows\\System32",
    "AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
  ],
  dangerousCommands: [
    "rm -rf",
    "del /s",
    "rmdir /s",
    "rd /s",
    "format ",
    "diskpart",
    "bcdedit",
    "vssadmin delete",
    "reg add",
    "reg delete",
    "regedit",
    "schtasks",
    "sc ",
    "net user",
    "net localgroup",
    "takeown",
    "icacls /grant",
    "powershell -enc",
    "powershell -encodedcommand",
    "Invoke-Expression",
    "| bash",
    "curl | sh",
    "wget | sh",
  ],
  blockedEnvKeys: [
    "PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "RUBYLIB",
    "PERL5LIB",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "BASH_ENV",
    "ENV",
  ],
  blockedEnvPrefixes: ["LD_", "DYLD_"],
  sensitiveEnvKeys: ["KEY", "TOKEN", "SECRET", "PASSWORD", "PRIVATE"],
  workspaceRoots: [],
  allowedDomains: ["openai.com", "anthropic.com", "openrouter.ai", "googleapis.com", "github.com"],
  suspiciousThresholds: {
    maxRequestsPerMinute: 6,
    maxDirListings: 3,
  },
};

const resolvePolicySettings = (): PolicySettings => ({
  enabled: Boolean(settings.policyFileEnabled),
  path: settings.policyFilePath?.trim() || resolvePolicyFilePath(),
});

const ensurePolicyTemplate = async (policyPath: string) => {
  try {
    await fs.access(policyPath);
    return;
  } catch {
    // continue
  }
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, `${JSON.stringify(policyTemplate, null, 2)}\n`, "utf8");
};

const fetchPolicyStatus = async (): Promise<PolicyStatus> => {
  const base = resolvePolicySettings();
  if (!controllerProcess) {
    return {
      ok: true,
      controllerConnected: false,
      enabled: base.enabled,
      path: base.path,
      usingFile: false,
    };
  }
  try {
    const result = await fetchControllerJson("/policy");
    return {
      ok: Boolean(result?.ok),
      controllerConnected: true,
      enabled: Boolean(result?.enabled ?? base.enabled),
      path: String(result?.path ?? base.path),
      usingFile: Boolean(result?.usingFile),
      lastLoadedAt: typeof result?.lastLoadedAt === "string" ? result.lastLoadedAt : undefined,
      lastError: typeof result?.lastError === "string" ? result.lastError : undefined,
      workspaceRoot: typeof result?.workspaceRoot === "string" ? result.workspaceRoot : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      controllerConnected: false,
      enabled: base.enabled,
      path: base.path,
      usingFile: false,
      lastError: message,
    };
  }
};

const applyPolicySettings = async (next: PolicySettings): Promise<PolicyStatus> => {
  const normalizedPath = next.path.trim() || resolvePolicyFilePath();
  const enabled = Boolean(next.enabled);
  if (enabled) {
    await ensurePolicyTemplate(normalizedPath);
  }
  await saveSettings({
    ...settings,
    policyFileEnabled: enabled,
    policyFilePath: normalizedPath,
  });

  if (!controllerProcess) {
    return {
      ok: true,
      controllerConnected: false,
      enabled,
      path: normalizedPath,
      usingFile: false,
    };
  }

  try {
    const url = `http://127.0.0.1:${controllerPort}/policy`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, path: normalizedPath }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return {
      ok: Boolean(body?.ok),
      controllerConnected: true,
      enabled: Boolean(body?.enabled ?? enabled),
      path: String(body?.path ?? normalizedPath),
      usingFile: Boolean(body?.usingFile),
      lastLoadedAt: typeof body?.lastLoadedAt === "string" ? body.lastLoadedAt : undefined,
      lastError: typeof body?.lastError === "string" ? body.lastError : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      controllerConnected: false,
      enabled,
      path: normalizedPath,
      usingFile: false,
      lastError: message,
    };
  }
};

const ensureGatewayToken = async () => {
  if (gatewayToken) {
    return gatewayToken;
  }
  if (settings.gatewayToken) {
    gatewayToken = settings.gatewayToken;
    return gatewayToken;
  }
  gatewayToken = randomUUID();
  await saveSettings({ ...settings, gatewayToken });
  return gatewayToken;
};

const getDashboardUrl = () => {
  if (!gatewayToken) {
    return undefined;
  }
  return `http://127.0.0.1:${gatewayPort}/?token=${gatewayToken}`;
};

const resolveNodePath = () => {
  if (isDev) {
    return process.env.AEGIS_NODE_PATH ?? "node";
  }
  return path.join(process.resourcesPath, "node", "node.exe");
};

const resolveNpmCliPath = () => {
  const nodePath = resolveNodePath();
  const nodeDir = path.dirname(nodePath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.cjs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const resolveCmdExecutable = () => {
  const comSpec = process.env.ComSpec;
  if (comSpec && existsSync(comSpec)) {
    return comSpec;
  }
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "cmd.exe");
};

const resolveOpenClawRoot = () => {
  if (isDev) {
    return path.resolve(getRepoRoot(), "openclaw");
  }
  const installedRoot = findOpenClawRoot();
  if (installedRoot) {
    return installedRoot;
  }
  return resolveBundledOpenClawRoot();
};

const resolveOpenClawWorkingDir = (launch?: OpenClawLaunchTarget) => {
  const installedRoot = findOpenClawRoot();
  if (installedRoot && existsSync(installedRoot)) {
    return installedRoot;
  }
  if (launch?.mode === "cmd") {
    const wrapperDir = path.dirname(launch.cmd);
    if (existsSync(wrapperDir)) {
      return wrapperDir;
    }
  }
  const bundledRoot = resolveBundledOpenClawRoot();
  if (existsSync(bundledRoot)) {
    return bundledRoot;
  }
  const runtimeRoot = resolveRuntimeRoot();
  if (existsSync(runtimeRoot)) {
    return runtimeRoot;
  }
  return resolveAegisDataDir();
};

const resolveOpenClawEntry = () => path.join(resolveOpenClawRoot(), "openclaw.mjs");

const resolveOpenClawExtensionsDir = () => path.join(resolveOpenClawRoot(), "extensions");
let cachedChannelPluginIds: string[] | null = null;
const listBundledChannelPluginIds = () => {
  if (cachedChannelPluginIds) {
    return cachedChannelPluginIds;
  }
  const extensionsDir = resolveOpenClawExtensionsDir();
  if (!existsSync(extensionsDir)) {
    cachedChannelPluginIds = [];
    return cachedChannelPluginIds;
  }
  const entries = readdirSync(extensionsDir, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(extensionsDir, entry.name, "openclaw.plugin.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    try {
      const raw = readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as { id?: string; channels?: unknown };
      const hasChannels = Array.isArray(parsed?.channels) && parsed.channels.length > 0;
      if (!hasChannels) {
        continue;
      }
      const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
      ids.push(id || entry.name);
    } catch {
      // ignore invalid manifest
    }
  }
  cachedChannelPluginIds = Array.from(new Set(ids.filter(Boolean)));
  return cachedChannelPluginIds;
};

const resolveControllerEntry = async () => {
  if (!isDev) {
    return path.join(process.resourcesPath, "controller", "index.js");
  }
  const distPath = path.resolve(getRepoRoot(), "apps", "aegis-controller", "dist", "index.js");
  const srcPath = path.resolve(getRepoRoot(), "apps", "aegis-controller", "src", "index.ts");
  try {
    await fs.access(distPath);
    return distPath;
  } catch {
    return srcPath;
  }
};

const resolvePluginPath = () => {
  if (isDev) {
    return path.resolve(getRepoRoot(), "extensions", "aegis-proxy");
  }
  return path.join(process.resourcesPath, "extensions", "aegis-proxy");
};

const resolveAssetsRoot = () => path.join(resolveAegisDataDir(), "assets");

const resolvePlaywrightAssetsPath = () => path.join(resolveAssetsRoot(), "playwright-browsers");

const resolvePlaywrightCli = () =>
  path.join(resolveOpenClawRoot(), "node_modules", "playwright-core", "cli.js");
const quotePowerShell = (value: string) => `'${value.replace(/'/g, "''")}'`;

const resolveUserBinCandidates = () => {
  const homeDir = process.env.USERPROFILE || app.getPath("home");
  const roamingDir = resolveRoamingDir();
  const candidates = [
    path.join(roamingDir, "npm"),
    homeDir ? path.join(homeDir, ".local", "bin") : null,
  ];
  return candidates.filter((entry): entry is string => Boolean(entry));
};

const resolveOpenClawRootCandidates = () => {
  const roamingDir = resolveRoamingDir();
  const homeDir = process.env.USERPROFILE || app.getPath("home");
  const programFiles = process.env.ProgramFiles;
  const candidates = [
    resolveManagedOpenClawRoot(),
    resolveRuntimeRoot(),
    path.join(roamingDir, "npm", "node_modules", "openclaw"),
    homeDir ? path.join(homeDir, ".local", "node_modules", "openclaw") : null,
    homeDir ? path.join(homeDir, "openclaw") : null,
    programFiles ? path.join(programFiles, "nodejs", "node_modules", "openclaw") : null,
  ];
  return candidates.filter((entry): entry is string => Boolean(entry) && existsSync(entry));
};

const findOpenClawRoot = () => {
  for (const candidate of resolveOpenClawRootCandidates()) {
    if (hasOpenClawBuild(candidate)) {
      return candidate;
    }
  }
  return null;
};

const hasOpenClawBuild = (root: string) => {
  if (!existsSync(path.join(root, "openclaw.mjs"))) {
    return false;
  }
  return (
    existsSync(path.join(root, "dist", "entry.js")) ||
    existsSync(path.join(root, "dist", "entry.mjs"))
  );
};

const resolveOpenClawCmdCandidates = () => {
  const roamingDir = resolveRoamingDir();
  const homeDir = process.env.USERPROFILE || app.getPath("home");
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const managedPrefix = resolveManagedRuntimePrefix();
  const candidates = [
    path.join(managedPrefix, "openclaw.cmd"),
    path.join(managedPrefix, "bin", "openclaw.cmd"),
    path.join(roamingDir, "npm", "openclaw.cmd"),
    homeDir ? path.join(homeDir, ".local", "bin", "openclaw.cmd") : null,
    programFiles ? path.join(programFiles, "nodejs", "openclaw.cmd") : null,
    programFilesX86 ? path.join(programFilesX86, "nodejs", "openclaw.cmd") : null,
  ];
  return candidates.filter((entry): entry is string => Boolean(entry) && existsSync(entry));
};

const resolveConfiguredRuntimeCmd = () => {
  const configuredPath = settings.runtimeInstalledPath?.trim();
  if (!configuredPath) {
    return null;
  }
  if (!existsSync(configuredPath)) {
    return null;
  }
  const ext = path.extname(configuredPath).toLowerCase();
  return ext === ".cmd" || ext === ".bat" ? configuredPath : null;
};

const isWrapperBackedByValidEntry = (cmdPath: string) => {
  try {
    const raw = readFileSync(cmdPath, "utf8");
    const match = raw.match(/node\s+"([^"]+)"/i);
    if (!match) {
      return true;
    }
    const target = match[1].replace(/\\\\/g, "\\");
    if (!existsSync(target)) {
      return false;
    }
    const normalized = target.toLowerCase().replace(/\//g, "\\");
    if (!normalized.endsWith("\\dist\\entry.js") && !normalized.endsWith("\\dist\\entry.mjs")) {
      return true;
    }
    const root = path.dirname(path.dirname(target));
    return hasOpenClawBuild(root);
  } catch {
    return false;
  }
};

const resolveHealthyOpenClawCmd = async (extraPath?: string) => {
  const configuredCmd = resolveConfiguredRuntimeCmd();
  if (configuredCmd && (await checkOpenClawCmdHealthy(configuredCmd, extraPath))) {
    return configuredCmd;
  }
  for (const candidate of resolveOpenClawCmdCandidates()) {
    if (await checkOpenClawCmdHealthy(candidate, extraPath)) {
      return candidate;
    }
  }
  return null;
};

const runOpenClawProbe = (command: string, args: string[], extraPath?: string) =>
  new Promise<boolean>((resolve) => {
    const proc = spawn(resolveCmdExecutable(), ["/c", command, ...args], {
      windowsHide: true,
      env: withExtraPath(extraPath),
    });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });

const checkOpenClawCmdHealthy = async (cmdPath: string, extraPath?: string) => {
  if (!isWrapperBackedByValidEntry(cmdPath)) {
    return false;
  }
  const probes = [
    ["--version"],
    ["version"],
    ["--help"],
  ];
  for (const probe of probes) {
    if (await runOpenClawProbe(cmdPath, probe, extraPath)) {
      return true;
    }
  }
  return false;
};

const checkOpenClawPathHealthy = async (extraPath?: string) => {
  const probes = [
    ["--version"],
    ["version"],
    ["--help"],
  ];
  for (const probe of probes) {
    if (await runOpenClawProbe("openclaw", probe, extraPath)) {
      return true;
    }
  }
  return false;
};

const checkOpenClawCliHealthy = async (extraPath?: string) => {
  const cmd = await resolveHealthyOpenClawCmd(extraPath);
  if (cmd) {
    return true;
  }
  return checkOpenClawPathHealthy(extraPath);
};

const resolveHealthyOpenClawEntry = () => {
  const root = findOpenClawRoot();
  if (root && hasOpenClawBuild(root)) {
    return path.join(root, "openclaw.mjs");
  }
  const bundledRoot = resolveBundledOpenClawRoot();
  if (hasOpenClawBuild(bundledRoot)) {
    return path.join(bundledRoot, "openclaw.mjs");
  }
  return null;
};

const resolveOpenClawLaunch = async (): Promise<OpenClawLaunchTarget> => {
  const configuredCmd = resolveConfiguredRuntimeCmd();
  if (configuredCmd) {
    if (await checkOpenClawCmdHealthy(configuredCmd)) {
      return { mode: "cmd" as const, cmd: configuredCmd };
    }
    emitLog(`[openclaw] Configured runtime wrapper is unhealthy: ${configuredCmd}`);
  }
  const entry = resolveHealthyOpenClawEntry();
  if (entry) {
    return { mode: "entry" as const, entry };
  }
  const cmd = await resolveHealthyOpenClawCmd();
  if (cmd) {
    return { mode: "cmd" as const, cmd };
  }
  if (await checkOpenClawPathHealthy()) {
    return { mode: "cmd" as const, cmd: "openclaw" };
  }
  return {
    mode: "none" as const,
    error:
      "OpenClaw runtime is installed but no healthy launcher was found. Reinstall runtime from the Runtime panel.",
  };
};

const getRuntimeStatus = async (): Promise<AegisRuntimeStatus> => {
  const installedRoot = findOpenClawRoot();
  const healthyCmd = await resolveHealthyOpenClawCmd();
  const cliHealthy = healthyCmd ? true : await checkOpenClawPathHealthy();
  const hintedPath =
    settings.runtimeInstalledPath && existsSync(settings.runtimeInstalledPath)
      ? settings.runtimeInstalledPath
      : undefined;
  return {
    installed: Boolean(installedRoot || cliHealthy),
    path:
      installedRoot ??
      (cliHealthy ? healthyCmd ?? "openclaw" : hintedPath ?? resolveManagedRuntimePrefix()),
    downloading: runtimeDownloading,
    lastError: runtimeLastError ?? undefined,
    method: settings.runtimeInstallMethod,
    installedAt: settings.runtimeInstalledAt,
  };
};

const emitRuntimeStatus = async () => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("aegis:runtime:status", await getRuntimeStatus());
};

const emitProgressStatus = () => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("aegis:progress", progressStatus);
};

const setProgressStatus = (next: AegisProgressStatus) => {
  if (progressClearTimer) {
    clearTimeout(progressClearTimer);
    progressClearTimer = null;
  }
  progressStatus = next;
  emitProgressStatus();
};

const completeProgressStatus = (task: "runtime" | "onboard" | "assets", message: string) => {
  setProgressStatus({ active: true, task, message, value: 100 });
  progressClearTimer = setTimeout(() => {
    progressClearTimer = null;
    if (progressStatus.task === task) {
      progressStatus = { active: false };
      emitProgressStatus();
    }
  }, 1500);
};

const ensureRuntimeReady = async () => {
  const status = await getRuntimeStatus();
  if (status.installed) {
    return { ok: true };
  }
  if (runtimeDownloading) {
    return { ok: false, error: "OpenClaw is installing. Please wait a moment." };
  }
  return {
    ok: false,
    error: "OpenClaw is not installed yet. It will install automatically on first run.",
  };
};

const withExtraPath = (extraPath?: string) => {
  const runtimeBins = resolveUserBinCandidates();
  const entries = [extraPath, ...runtimeBins, process.env.PATH ?? ""]
    .filter(Boolean)
    .join(";");
  return {
    ...process.env,
    PATH: entries,
  };
};

const checkCommandAvailable = (command: string, extraPath?: string) =>
  new Promise<boolean>((resolve) => {
    const proc = spawn(resolveCmdExecutable(), ["/c", "where", command], {
      windowsHide: true,
      env: withExtraPath(extraPath),
    });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });

const runSimpleCommand = (command: string, args: string[], extraPath?: string) =>
  new Promise<{ code: number | null }>((resolve, reject) => {
    const proc = spawn(command, args, {
      windowsHide: true,
      env: withExtraPath(extraPath),
    });
    proc.on("error", (err) => reject(err));
    proc.on("exit", (code) => resolve({ code }));
  });

const resolveNodeBinCandidates = () => {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const bundledNode = !isDev ? path.join(process.resourcesPath, "node") : null;
  const candidates = [
    bundledNode,
    programFiles ? path.join(programFiles, "nodejs") : null,
    programFilesX86 ? path.join(programFilesX86, "nodejs") : null,
  ];
  return candidates.filter((entry): entry is string => Boolean(entry) && existsSync(entry));
};

const resolveGitBinCandidates = () => {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    programFiles ? path.join(programFiles, "Git", "cmd") : null,
    programFilesX86 ? path.join(programFilesX86, "Git", "cmd") : null,
    localAppData ? path.join(localAppData, "Programs", "Git", "cmd") : null,
  ];
  return candidates.filter((entry): entry is string => Boolean(entry) && existsSync(entry));
};

const ensureNodeNpmHealthy = async () => {
  const candidates = resolveNodeBinCandidates();
  for (const nodeBin of candidates) {
    const npmOk = await runSimpleCommand(resolveCmdExecutable(), ["/c", "npm", "-v"], nodeBin).then(
      (result) => result.code === 0,
      () => false,
    );
    if (npmOk) {
      return { ok: true, extraPath: nodeBin };
    }
  }
  const preferredNodeBin = candidates[0];
  const hasWinget = await checkCommandAvailable("winget");
  if (!hasWinget) {
    return {
      ok: false,
      message:
        "npm is not available and winget is missing. Please install Node.js LTS from nodejs.org.",
      extraPath: preferredNodeBin,
    };
  }
  emitLog("[runtime] Repairing Node.js/npm via winget...");
  const installArgs = [
    "install",
    "--id",
    "OpenJS.NodeJS.LTS",
    "-e",
    "--silent",
    "--accept-source-agreements",
    "--accept-package-agreements",
    "--disable-interactivity",
  ];
  const install = await runSimpleCommand("winget", installArgs).catch(() => ({ code: null }));
  const refreshedCandidates = resolveNodeBinCandidates();
  for (const nodeBin of refreshedCandidates) {
    const npmAfter = await runSimpleCommand(resolveCmdExecutable(), ["/c", "npm", "-v"], nodeBin).then(
      (result) => result.code === 0,
      () => false,
    );
    if (npmAfter) {
      return { ok: true, extraPath: nodeBin };
    }
  }
  return {
    ok: false,
    message: `Node.js/npm repair failed (winget code ${install.code ?? "unknown"}).`,
    extraPath: refreshedCandidates[0],
  };
};

const ensureGitAvailable = async () => {
  const gitBin = resolveGitBinCandidates()[0];
  const gitOk = await checkCommandAvailable("git", gitBin);
  if (gitOk) {
    return { ok: true, extraPath: gitBin };
  }
  const hasWinget = await checkCommandAvailable("winget");
  if (!hasWinget) {
    return {
      ok: false,
      message:
        "Git is required for GitHub install and winget is unavailable. Install Git for Windows and retry.",
      extraPath: gitBin,
    };
  }
  emitLog("[runtime] Installing Git for Windows via winget...");
  const installArgs = [
    "install",
    "--id",
    "Git.Git",
    "-e",
    "--silent",
    "--accept-source-agreements",
    "--accept-package-agreements",
    "--disable-interactivity",
  ];
  const install = await runSimpleCommand("winget", installArgs).catch(() => ({ code: null }));
  const refreshedGitBin = resolveGitBinCandidates()[0];
  const gitAfter = await checkCommandAvailable("git", refreshedGitBin);
  if (gitAfter) {
    return { ok: true, extraPath: refreshedGitBin };
  }
  return {
    ok: false,
    message: `Git installation failed (winget code ${install.code ?? "unknown"}).`,
    extraPath: refreshedGitBin,
  };
};

const runManagedNpmInstaller = (extraPath?: string) =>
  new Promise<{ code: number | null; timedOut: boolean }>((resolve, reject) => {
    let settled = false;
    const settle = (result: { code: number | null; timedOut: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      if (hardTimeout) {
        clearTimeout(hardTimeout);
      }
      resolve(result);
    };
    const managedPrefix = resolveManagedRuntimePrefix();
    const npmCli = resolveNpmCliPath();
    if (npmCli) {
      runtimeInstallProcess = spawn(
        resolveNodePath(),
        [
          npmCli,
          "install",
          "-g",
          "openclaw@latest",
          "--prefix",
          managedPrefix,
          "--no-audit",
          "--no-fund",
        ],
        {
          windowsHide: true,
          env: withExtraPath(extraPath),
        },
      );
    } else {
      const installArgs = [
        "/c",
        "npm",
        "install",
        "-g",
        "openclaw@latest",
        "--prefix",
        managedPrefix,
        "--no-audit",
        "--no-fund",
      ];
      runtimeInstallProcess = spawn(resolveCmdExecutable(), installArgs, {
        windowsHide: true,
        env: withExtraPath(extraPath),
      });
    }
    runtimeInstallProcess.stdout.on("data", (data) => emitLog(`[runtime] ${data.toString()}`));
    runtimeInstallProcess.stderr.on("data", (data) => emitLog(`[runtime] ${data.toString()}`));
    runtimeInstallProcess.on("error", (err) => {
      if (hardTimeout) {
        clearTimeout(hardTimeout);
      }
      reject(err);
    });
    runtimeInstallProcess.on("exit", (code) => settle({ code, timedOut: false }));

    const hardTimeout = setTimeout(() => {
      if (!runtimeInstallProcess || settled) {
        return;
      }
      emitLog("[runtime] npm installation timed out. Please retry installation.");
      runtimeInstallProcess.kill();
      settle({ code: null, timedOut: true });
    }, 25 * 60 * 1000);
  });

const cleanupLegacyRuntimeArtifacts = async () => {
  const legacyRoot = resolveRuntimeRoot();
  if (existsSync(legacyRoot) && !hasOpenClawBuild(legacyRoot)) {
    await fs.rm(legacyRoot, { recursive: true, force: true }).catch(() => undefined);
    emitLog("[runtime] Removed stale legacy runtime checkout.");
  }
  const homeDir = process.env.USERPROFILE || app.getPath("home");
  const legacyWrappers = [
    homeDir ? path.join(homeDir, ".local", "bin", "openclaw.cmd") : null,
    path.join(resolveRoamingDir(), "npm", "openclaw.cmd"),
  ].filter((entry): entry is string => Boolean(entry) && existsSync(entry));
  for (const wrapper of legacyWrappers) {
    if (!isWrapperBackedByValidEntry(wrapper)) {
      await fs.rm(wrapper, { force: true }).catch(() => undefined);
      emitLog(`[runtime] Removed stale wrapper: ${wrapper}`);
    }
  }
};

const installOpenClaw = async (payload: AegisRuntimeInstallRequest) => {
  if (runtimeDownloading) {
    return { started: false, message: "OpenClaw install already in progress." };
  }
  runtimeDownloading = true;
  runtimeLastError = null;
  setProgressStatus({
    active: true,
    task: "runtime",
    message: "Preparing OpenClaw runtime installation...",
    value: 5,
  });
  void emitRuntimeStatus();
  emitLog("[runtime] Installing OpenClaw...");

  const requestedMethod = payload.method ?? "git";
  const method: "npm" = "npm";
  await saveSettings({ ...settings, runtimeInstallMethod: method });

  const finalize = async (ok: boolean, errorMessage?: string) => {
    runtimeDownloading = false;
    runtimeInstallProcess = null;
    if (ok) {
      const installedRoot = findOpenClawRoot();
      const healthyCmd = await resolveHealthyOpenClawCmd();
      const cliHealthy = healthyCmd ? true : await checkOpenClawPathHealthy();
      const fallbackCmd = resolveOpenClawCmdCandidates()[0];
      const runtimePath =
        installedRoot ??
        (cliHealthy ? healthyCmd ?? "openclaw" : fallbackCmd ?? settings.runtimeInstalledPath ?? "openclaw");
      await saveSettings({
        ...settings,
        runtimeInstallMethod: method,
        runtimeInstalledAt: new Date().toISOString(),
        runtimeInstalledPath: runtimePath,
      });
      emitLog(`[runtime] OpenClaw installed at ${runtimePath}`);
      completeProgressStatus("runtime", "OpenClaw runtime installed.");
    } else if (errorMessage) {
      runtimeLastError = errorMessage;
      emitLog(`[runtime] Install failed: ${errorMessage}`);
      setProgressStatus({
        active: false,
        task: "runtime",
        message: errorMessage,
      });
    }
    void emitRuntimeStatus();
  };

  try {
    setProgressStatus({
      active: true,
      task: "runtime",
      message: "Checking Node.js and npm...",
      value: 15,
    });
    const nodeCheck = await ensureNodeNpmHealthy();
    if (!nodeCheck.ok) {
      await finalize(false, nodeCheck.message);
      return { started: false, message: nodeCheck.message };
    }

    let extraPath = nodeCheck.extraPath;
    setProgressStatus({
      active: true,
      task: "runtime",
      message: "Preparing managed OpenClaw runtime...",
      value: 30,
    });
    await cleanupLegacyRuntimeArtifacts();
    emitLog(
      `[runtime] Install method: ${requestedMethod} (using managed npm runtime for reliability)`,
    );
    setProgressStatus({
      active: true,
      task: "runtime",
      message: "Installing OpenClaw runtime package...",
      value: 50,
    });
    const npmResult = await runManagedNpmInstaller(extraPath);
    if (npmResult.code === 0 && (findOpenClawRoot() || (await checkOpenClawCliHealthy(extraPath)))) {
      await finalize(true);
      return { started: true };
    }
    if (npmResult.timedOut) {
      await finalize(false, "Installer timed out before completion. Please retry.");
      return { started: false, message: runtimeLastError ?? "OpenClaw install timed out." };
    }
    await finalize(
      false,
      `Installer failed (npm code ${npmResult.code ?? "unknown"}).`,
    );
    return { started: false, message: runtimeLastError ?? "OpenClaw install failed." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalize(false, message);
    return { started: false, message };
  }
};

const maybeAutoInstallOpenClaw = async () => {
  if (isDev) {
    return;
  }
  const status = await getRuntimeStatus();
  if (!status.installed && !runtimeDownloading) {
    void installOpenClaw({ method: "git" });
  }
};

const getAssetsStatus = async () => {
  const playwrightPath = resolvePlaywrightAssetsPath();
  let installed = false;
  try {
    const entries = await fs.readdir(playwrightPath, { withFileTypes: true });
    installed = entries.some((entry) => entry.isDirectory());
  } catch {
    installed = false;
  }
  return {
    playwright: {
      installed,
      path: playwrightPath,
      downloading: Boolean(assetsDownloadProcess),
      lastError: assetsLastError ?? undefined,
    },
  };
};

const emitAssetsStatus = async () => {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send("aegis:assets:status", await getAssetsStatus());
};

const loadOpenClawConfig = async (configPath: string) => {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const applyAegisOverlay = (
  config: Record<string, unknown>,
  controllerUrl: string,
  modelOverride?: string,
) => {
  const pluginPath = resolvePluginPath();
  const next: Record<string, unknown> = { ...config };

  const gateway = (next.gateway as Record<string, unknown> | undefined) ?? {};
  const gatewayAuth = (gateway.auth as Record<string, unknown> | undefined) ?? {};
  const gatewayControlUi = (gateway.controlUi as Record<string, unknown> | undefined) ?? {};
  next.gateway = {
    ...gateway,
    mode: "local",
    bind: "loopback",
    port: gatewayPort,
    auth: {
      ...gatewayAuth,
      mode: "token",
      token: gatewayToken,
    },
    controlUi: {
      ...gatewayControlUi,
      enabled: true,
      allowInsecureAuth: true,
      basePath: "/",
    },
  };

  const plugins = (next.plugins as Record<string, unknown> | undefined) ?? {};
  const pluginLoad = (plugins.load as Record<string, unknown> | undefined) ?? {};
  const pluginPaths = new Set<string>(
    Array.isArray(pluginLoad.paths)
      ? (pluginLoad.paths as string[]).filter(
          (entry) => !entry.toLowerCase().includes("aegis-proxy"),
        )
      : [],
  );
  pluginPaths.add(pluginPath);
  const pluginEntries = (plugins.entries as Record<string, unknown> | undefined) ?? {};
  const nextPluginEntries: Record<string, unknown> = {
    ...pluginEntries,
    "aegis-proxy": { enabled: true, config: { controllerUrl } },
  };
  for (const pluginId of listBundledChannelPluginIds()) {
    const existing = nextPluginEntries[pluginId];
    if (existing && typeof existing === "object") {
      const entry = existing as Record<string, unknown>;
      if (entry.enabled === false) {
        continue;
      }
      nextPluginEntries[pluginId] = { ...entry, enabled: entry.enabled ?? true };
    } else {
      nextPluginEntries[pluginId] = { enabled: true };
    }
  }
  next.plugins = {
    ...plugins,
    load: { ...pluginLoad, paths: Array.from(pluginPaths) },
    entries: nextPluginEntries,
  };

  const tools = (next.tools as Record<string, unknown> | undefined) ?? {};
  next.tools = {
    ...tools,
    profile: "full",
  };

  const agents = (next.agents as Record<string, unknown> | undefined) ?? {};
  const agentList = Array.isArray(agents.list) ? (agents.list as Record<string, unknown>[]) : [];
  const filtered = agentList.filter((agent) => agent?.id !== "main" && agent?.id !== "aegis-exec");
  const mainAgent: Record<string, unknown> = {
    ...(agentList.find((agent) => agent?.id === "main") ?? {}),
    id: "main",
    default: true,
    tools: { profile: "full", allow: ["session_status", "aegis_proxy"] },
  };
  if (modelOverride) {
    mainAgent.model = modelOverride;
  }
  const execAgent: Record<string, unknown> = {
    id: "aegis-exec",
    tools: {
      profile: "full",
    },
  };
  const defaults = (agents.defaults as Record<string, unknown> | undefined) ?? {};
  const existingModel = defaults.model;
  const normalizedDefaults =
    typeof existingModel === "string"
      ? { ...defaults, model: { primary: existingModel } }
      : defaults;
  next.agents = {
    ...agents,
    defaults: modelOverride
      ? {
          ...normalizedDefaults,
          model: {
            ...(typeof normalizedDefaults.model === "object" && normalizedDefaults.model
              ? (normalizedDefaults.model as Record<string, unknown>)
              : {}),
            primary: modelOverride,
          },
        }
      : normalizedDefaults,
    list: [mainAgent, ...filtered, execAgent],
  };

  return next;
};

const writeOpenClawConfig = async (
  configPath: string,
  controllerUrl: string,
  modelOverride?: string,
) => {
  const baseConfig = await loadOpenClawConfig(configPath);
  const nextConfig = applyAegisOverlay(baseConfig, controllerUrl, modelOverride);
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return nextConfig;
};

const startOpenClaw = async () => {
  if (openclawProcess) {
    return;
  }
  const runtimeReady = await ensureRuntimeReady();
  if (!runtimeReady.ok) {
    emitLog(`[system] ${runtimeReady.error}`);
    return;
  }
  await ensureGatewayToken();
  const playwrightPath = resolvePlaywrightAssetsPath();
  const stateDir = resolveOpenClawStateDir();
  const configPath = resolveOpenClawConfigPath();
  const controllerUrl = `http://127.0.0.1:${controllerPort}`;
  await fs.mkdir(stateDir, { recursive: true });
  await writeOpenClawConfig(configPath, controllerUrl);

  const launch = await resolveOpenClawLaunch();
  if (launch.mode === "none") {
    runtimeLastError = launch.error;
    emitLog(`[openclaw] ${launch.error}`);
    void emitRuntimeStatus();
    return;
  }
  const workingDir = resolveOpenClawWorkingDir(launch);
  const nodePath = resolveNodePath();
  const baseEnv = {
    ...process.env,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_CONFIG_PATH: configPath,
    PLAYWRIGHT_BROWSERS_PATH: playwrightPath,
  };
  if (launch.mode === "cmd") {
    emitLog(`[openclaw] Launching via CLI: ${launch.cmd} (cwd: ${workingDir})`);
    openclawProcess = spawn(resolveCmdExecutable(), ["/c", launch.cmd, "gateway"], {
      cwd: workingDir,
      env: baseEnv,
    });
  } else {
    emitLog(`[openclaw] Launching via entry: ${launch.entry} (cwd: ${workingDir})`);
    openclawProcess = spawn(nodePath, [launch.entry, "gateway"], {
      cwd: workingDir,
      env: baseEnv,
    });
  }

  openclawProcess.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    emitLog(`[openclaw] process error: ${message}`);
    openclawProcess = null;
  });
  openclawProcess.stdout.on("data", (data) => emitLog(`[openclaw] ${data.toString()}`));
  openclawProcess.stderr.on("data", (data) => emitLog(`[openclaw] ${data.toString()}`));
  openclawProcess.on("exit", (code, signal) => {
    emitLog(`[openclaw] process exited (code ${code ?? "null"}, signal ${signal ?? "none"})`);
    openclawProcess = null;
  });
};

const startController = async () => {
  if (controllerProcess) {
    return;
  }
  await ensureGatewayToken();
  const logPath = await ensureSessionLogFile();
  const controllerEntry = await resolveControllerEntry();
  if (controllerEntry.endsWith(".ts")) {
    emitLog("[controller] Build required: run npm run build --workspace apps/aegis-controller");
    return;
  }
  const nodePath = resolveNodePath();
  controllerProcess = spawn(nodePath, [controllerEntry], {
    env: {
      ...process.env,
      AEGIS_GATEWAY_TOKEN: gatewayToken,
      AEGIS_GATEWAY_HTTP: `http://127.0.0.1:${gatewayPort}`,
      AEGIS_GATEWAY_WS: `ws://127.0.0.1:${gatewayPort}`,
      AEGIS_CONTROLLER_PORT: String(controllerPort),
      AEGIS_LOG_PATH: logPath,
      AEGIS_LOG_MAX_MB: process.env.AEGIS_LOG_MAX_MB ?? "50",
      AEGIS_METRICS_PATH: resolveAegisMetricsPath(),
      AEGIS_WORKSPACE_DIR: resolveWorkspaceDir(),
      AEGIS_POLICY_PATH: settings.policyFilePath ?? resolvePolicyFilePath(),
      AEGIS_POLICY_ENABLED: settings.policyFileEnabled ? "true" : "false",
    },
  });

  controllerProcess.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    emitLog(`[controller] process error: ${message}`);
    controllerProcess = null;
  });
  controllerProcess.stdout.on("data", (data) => emitLog(`[controller] ${data.toString()}`));
  controllerProcess.stderr.on("data", (data) => emitLog(`[controller] ${data.toString()}`));
  controllerProcess.on("exit", (code, signal) => {
    emitLog(`[controller] process exited (code ${code ?? "null"}, signal ${signal ?? "none"})`);
    controllerProcess = null;
  });
};

const stopProcesses = () => {
  controllerProcess?.kill();
  openclawProcess?.kill();
  controllerProcess = null;
  openclawProcess = null;
};

const getStatus = () => ({
  running: Boolean(openclawProcess && controllerProcess),
  controllerRunning: Boolean(controllerProcess),
  openclawRunning: Boolean(openclawProcess),
  gatewayPort,
});

const fetchControllerJson = async <T = unknown>(pathName: string): Promise<T> => {
  const url = `http://127.0.0.1:${controllerPort}${pathName}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Controller request failed (${res.status})`);
  }
  return (await res.json()) as T;
};

const emitLog = (line: string) => {
  if (!mainWindow) {
    return;
  }
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  mainWindow.webContents.send("aegis:log", `${new Date().toISOString()} ${trimmed}`);
};

const resolvePreloadPath = () => {
  const cjsPath = path.join(__dirname, "../preload/index.cjs");
  if (existsSync(cjsPath)) {
    return cjsPath;
  }
  const jsPath = path.join(__dirname, "../preload/index.js");
  if (existsSync(jsPath)) {
    return jsPath;
  }
  return path.join(__dirname, "../preload/index.mjs");
};

const getSetupStatus = async (): Promise<AegisSetupStatus> => {
  await ensureGatewayToken();
  return {
    onboardingComplete: settings.onboardingComplete,
    gatewayToken,
    provider: settings.provider,
    model: settings.model,
    communication: settings.communication,
    dashboardUrl: getDashboardUrl(),
  };
};

const runOpenClawOnboard = async (payload: OnboardRequest) => {
  const runtimeReady = await ensureRuntimeReady();
  if (!runtimeReady.ok) {
    emitLog(`[onboard] ${runtimeReady.error}`);
    return { ok: false, error: runtimeReady.error };
  }
  setProgressStatus({
    active: true,
    task: "onboard",
    message: "Starting OpenClaw onboarding...",
    value: 10,
  });
  const token = payload.gatewayToken?.trim() || settings.gatewayToken || randomUUID();
  gatewayToken = token;
  const nodePath = resolveNodePath();
  const launch = await resolveOpenClawLaunch();
  if (launch.mode === "none") {
    setProgressStatus({ active: false, task: "onboard", message: launch.error });
    return { ok: false, error: launch.error };
  }
  const workingDir = resolveOpenClawWorkingDir(launch);
  const configPath = resolveOpenClawConfigPath();
  const stateDir = resolveOpenClawStateDir();
  const workspaceDir = resolveWorkspaceDir();
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--skip-skills",
    "--skip-health",
    "--skip-channels",
    "--flow",
    "quickstart",
    "--workspace",
    workspaceDir,
    "--gateway-port",
    String(gatewayPort),
    "--gateway-bind",
    "loopback",
    "--gateway-auth",
    "token",
    "--gateway-token",
    token,
  ];

  const provider = payload.provider?.trim() || "skip";
  const apiKey = payload.apiKey?.trim();
  const authMap: Record<
    string,
    { choice: string; flag: string }
  > = {
    anthropic: { choice: "apiKey", flag: "--anthropic-api-key" },
    openai: { choice: "openai-api-key", flag: "--openai-api-key" },
    openrouter: { choice: "openrouter-api-key", flag: "--openrouter-api-key" },
    gemini: { choice: "gemini-api-key", flag: "--gemini-api-key" },
    zai: { choice: "zai-api-key", flag: "--zai-api-key" },
    xiaomi: { choice: "xiaomi-api-key", flag: "--xiaomi-api-key" },
    minimax: { choice: "minimax-api", flag: "--minimax-api-key" },
    "minimax-lightning": { choice: "minimax-api-lightning", flag: "--minimax-api-key" },
    moonshot: { choice: "moonshot-api-key", flag: "--moonshot-api-key" },
    kimi: { choice: "kimi-code-api-key", flag: "--kimi-code-api-key" },
    synthetic: { choice: "synthetic-api-key", flag: "--synthetic-api-key" },
    venice: { choice: "venice-api-key", flag: "--venice-api-key" },
    "ai-gateway": { choice: "ai-gateway-api-key", flag: "--ai-gateway-api-key" },
    "cloudflare-ai-gateway": {
      choice: "cloudflare-ai-gateway-api-key",
      flag: "--cloudflare-ai-gateway-api-key",
    },
    "opencode-zen": { choice: "opencode-zen", flag: "--opencode-zen-api-key" },
  };

  if (provider !== "skip") {
    const mapped = authMap[provider];
    if (!mapped) {
      return { ok: false, error: `Unsupported provider: ${provider}.` };
    }
    if (!apiKey) {
      return { ok: false, error: "API key is required for the selected provider." };
    }
    args.push("--auth-choice", mapped.choice, mapped.flag, apiKey);
  }

  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  emitLog("[onboard] Starting OpenClaw onboarding...");
  setProgressStatus({
    active: true,
    task: "onboard",
    message: "Applying onboarding configuration...",
    value: 35,
  });
  const result = await new Promise<{ code: number | null }>((resolve, reject) => {
    const proc =
      launch.mode === "cmd"
        ? spawn(resolveCmdExecutable(), ["/c", launch.cmd, ...args], {
            cwd: workingDir,
            env: {
              ...process.env,
              OPENCLAW_CONFIG_PATH: configPath,
              OPENCLAW_STATE_DIR: stateDir,
              OPENCLAW_GATEWAY_TOKEN: token,
            },
          })
        : spawn(nodePath, [launch.entry, ...args], {
            cwd: workingDir,
            env: {
              ...process.env,
              OPENCLAW_CONFIG_PATH: configPath,
              OPENCLAW_STATE_DIR: stateDir,
              OPENCLAW_GATEWAY_TOKEN: token,
            },
          });
    proc.stdout.on("data", (data) => {
      const text = data.toString();
      emitLog(`[onboard] ${text}`);
      if (text.includes("Updated ")) {
        setProgressStatus({
          active: true,
          task: "onboard",
          message: "Saving OpenClaw configuration...",
          value: 75,
        });
      }
    });
    proc.stderr.on("data", (data) => emitLog(`[onboard] ${data.toString()}`));
    proc.on("error", (err) => reject(err));
    proc.on("exit", (code) => resolve({ code }));
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    return { code: null, error: message } as { code: number | null; error: string };
  });

  if ("error" in result && result.error) {
    setProgressStatus({
      active: false,
      task: "onboard",
      message: result.error,
    });
    return { ok: false, error: result.error };
  }
  if (result.code !== 0) {
    setProgressStatus({
      active: false,
      task: "onboard",
      message: `OpenClaw onboarding failed (code ${result.code ?? "unknown"}).`,
    });
    return { ok: false, error: `OpenClaw onboarding failed (code ${result.code ?? "unknown"}).` };
  }

  const controllerUrl = `http://127.0.0.1:${controllerPort}`;
  const model = payload.model?.trim();
  await writeOpenClawConfig(configPath, controllerUrl, model || undefined);

  await saveSettings({
    onboardingComplete: true,
    gatewayToken: token,
    provider: provider === "skip" ? undefined : provider,
    model: model || undefined,
    communication: payload.communication ?? "web",
  });

  completeProgressStatus("onboard", "Onboarding completed.");
  return { ok: true };
};

const normalizeModelRef = (provider: string, model?: string) => {
  const trimmed = model?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return provider ? `${provider}/${trimmed}` : trimmed;
};

const updateAuthProfiles = async (provider: string, apiKey: string) => {
  const profileId = `${provider}:default`;
  const authPath = resolveAuthProfilesPath();
  let store: {
    version: number;
    profiles: Record<string, unknown>;
    lastGood?: Record<string, string>;
    usageStats?: Record<string, unknown>;
  } = { version: 1, profiles: {} };
  try {
    const raw = await fs.readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as typeof store;
    if (parsed && typeof parsed === "object") {
      store = { ...store, ...parsed };
    }
  } catch {
    // start fresh
  }
  store.profiles = {
    ...(store.profiles ?? {}),
    [profileId]: {
      type: "api_key",
      provider,
      key: apiKey,
    },
  };
  store.lastGood = { ...(store.lastGood ?? {}), [provider]: profileId };
  store.usageStats = { ...(store.usageStats ?? {}), [profileId]: { errorCount: 0 } };
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  await fs.writeFile(authPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
};

const updateProviderAndModel = async (payload: UpdateProviderRequest) => {
  const provider = payload.provider?.trim();
  if (!provider) {
    return { ok: false, error: "Provider is required." };
  }
  const apiKey = payload.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, error: "API key is required for the selected provider." };
  }
  const modelRef = normalizeModelRef(provider, payload.model);
  await updateAuthProfiles(provider, apiKey);

  const configPath = resolveOpenClawConfigPath();
  const controllerUrl = `http://127.0.0.1:${controllerPort}`;
  const baseConfig = await loadOpenClawConfig(configPath);
  const nextConfig = applyAegisOverlay(baseConfig, controllerUrl, modelRef);
  const authProfiles = (nextConfig.auth as Record<string, unknown> | undefined) ?? {};
  const profiles = (authProfiles.profiles as Record<string, unknown> | undefined) ?? {};
  nextConfig.auth = {
    ...authProfiles,
    profiles: {
      ...profiles,
      [`${provider}:default`]: {
        provider,
        mode: "api_key",
      },
    },
  };
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  await saveSettings({
    ...settings,
    provider,
    model: modelRef ?? settings.model,
  });

  stopProcesses();
  await startOpenClaw();
  await startController();
  return { ok: true, setup: await getSetupStatus() };
};

const runOnboarding = async (payload: OnboardRequest) => {
  if (!payload.acceptRisk) {
    return { ok: false, error: "Acknowledgement required before onboarding." };
  }
  stopProcesses();
  const result = await runOpenClawOnboard(payload);
  if (!result.ok) {
    return result;
  }
  await startOpenClaw();
  await startController();
  return { ok: true, status: getStatus(), setup: await getSetupStatus() };
};

const openDashboard = async () => {
  const url = getDashboardUrl();
  if (url) {
    await shell.openExternal(url);
  }
  return { url };
};

const downloadPlaywrightAssets = async () => {
  if (assetsDownloadProcess) {
    return { started: false, message: "Download already in progress." };
  }
  const nodePath = resolveNodePath();
  const cliPath = resolvePlaywrightCli();
  const browsersPath = resolvePlaywrightAssetsPath();
  assetsLastError = null;
  try {
    await fs.access(cliPath);
  } catch {
    assetsLastError = "Playwright CLI not found in the OpenClaw runtime.";
    void emitAssetsStatus();
    return { started: false, message: assetsLastError };
  }
  await fs.mkdir(browsersPath, { recursive: true });
  setProgressStatus({
    active: true,
    task: "assets",
    message: "Downloading Playwright Chromium runtime...",
    value: 10,
  });
  assetsDownloadProcess = spawn(nodePath, [cliPath, "install", "chromium"], {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
  });

  assetsDownloadProcess.stdout.on("data", (data) => {
    emitLog(`[assets] ${data.toString()}`);
    setProgressStatus({
      active: true,
      task: "assets",
      message: "Downloading Playwright Chromium runtime...",
      value: 60,
    });
  });
  assetsDownloadProcess.stderr.on("data", (data) => emitLog(`[assets] ${data.toString()}`));
  assetsDownloadProcess.on("error", (err) => {
    assetsLastError = err instanceof Error ? err.message : String(err);
    assetsDownloadProcess = null;
    setProgressStatus({
      active: false,
      task: "assets",
      message: assetsLastError ?? "Asset download failed.",
    });
    void emitAssetsStatus();
  });
  assetsDownloadProcess.on("exit", (code) => {
    if (code && code !== 0) {
      assetsLastError = `Playwright browser download failed (code ${code}).`;
      setProgressStatus({
        active: false,
        task: "assets",
        message: assetsLastError,
      });
    } else {
      completeProgressStatus("assets", "Browser assets downloaded.");
    }
    assetsDownloadProcess = null;
    void emitAssetsStatus();
  });

  void emitAssetsStatus();
  return { started: true };
};

const getMetrics = async () => {
  try {
    return await fetchControllerJson("/metrics");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
};

const fallbackModels = [
  { id: "openai/gpt-4.1", name: "GPT-4.1", provider: "openai" },
  { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic" },
  { id: "openrouter/anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", provider: "openrouter" },
  { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini" },
  { id: "zai/glm-4.5", name: "GLM 4.5", provider: "zai" },
  { id: "qwen/qwen2.5-72b-instruct", name: "Qwen 2.5 72B", provider: "qwen" },
  { id: "minimax/abab-6.5", name: "MiniMax abab 6.5", provider: "minimax" },
  { id: "moonshot/moonshot-v1-32k", name: "Moonshot V1 32K", provider: "moonshot" },
  { id: "venice/venice-2.0", name: "Venice 2.0", provider: "venice" },
];

const getModels = async () => {
  if (!controllerProcess) {
    return { ok: true, models: fallbackModels };
  }
  try {
    return await fetchControllerJson("/models");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: true, error: message, models: fallbackModels };
  }
};

const resolveActiveLogPath = async () => {
  if (controllerProcess) {
    try {
      const result = await fetchControllerJson<{ logPath?: unknown }>("/metrics");
      if (result && typeof result.logPath === "string") {
        return result.logPath;
      }
    } catch {
      // fall through
    }
  }
  return ensureSessionLogFile();
};

const openAuditLog = async () => {
  const logPath = await resolveActiveLogPath();
  await shell.openPath(logPath);
  return { path: logPath };
};

const openAuditLogFolder = async () => {
  const logPath = await resolveActiveLogPath();
  const dirPath = path.dirname(logPath);
  await shell.openPath(dirPath);
  return { path: dirPath };
};

const openPolicyFile = async () => {
  const policyPath = resolvePolicySettings().path;
  await ensurePolicyTemplate(policyPath);
  await shell.openPath(policyPath);
  return { path: policyPath };
};

const openPolicyFolder = async () => {
  const policyPath = resolvePolicySettings().path;
  const dirPath = path.dirname(policyPath);
  await shell.openPath(dirPath);
  return { path: dirPath };
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(async () => {
  const migration = await migrateLegacyUserData();
  settings = await loadSettings();
  if (settings.gatewayToken) {
    gatewayToken = settings.gatewayToken;
  }
  await ensureSessionLogFile();
  createWindow();
  emitLog(`[system] Aegis desktop ${app.getVersion()} started`);

  if (migration.migrated && migration.entries.length > 0) {
    emitLog(
      `[system] Migrated ${migration.entries.join(", ")} from ${migration.from} to ${migration.to}`,
    );
  } else if (migration.error) {
    emitLog(`[system] Migration failed: ${migration.error}`);
  }

  ipcMain.handle("aegis:start", async () => {
    await startOpenClaw();
    await startController();
    return getStatus();
  });

  ipcMain.handle("aegis:stop", async () => {
    stopProcesses();
    return getStatus();
  });

  ipcMain.handle("aegis:status", async () => getStatus());
  ipcMain.handle("aegis:setup:status", async () => getSetupStatus());
  ipcMain.handle("aegis:onboard", async (_event, payload: OnboardRequest) => runOnboarding(payload));
  ipcMain.handle("aegis:open-dashboard", async () => openDashboard());
  ipcMain.handle("aegis:runtime:status", async () => getRuntimeStatus());
  ipcMain.handle("aegis:runtime:download", async (_event, payload: AegisRuntimeInstallRequest) =>
    installOpenClaw(payload),
  );
  ipcMain.handle("aegis:progress:status", async () => progressStatus);
  ipcMain.handle("aegis:assets:status", async () => getAssetsStatus());
  ipcMain.handle("aegis:assets:download", async () => downloadPlaywrightAssets());
  ipcMain.handle("aegis:update-provider", async (_event, payload: UpdateProviderRequest) =>
    updateProviderAndModel(payload),
  );
  ipcMain.handle("aegis:metrics", async () => getMetrics());
  ipcMain.handle("aegis:models", async () => getModels());
  ipcMain.handle("aegis:log-path", async () => ({ path: await resolveActiveLogPath() }));
  ipcMain.handle("aegis:log-open", async () => openAuditLog());
  ipcMain.handle("aegis:log-open-folder", async () => openAuditLogFolder());
  ipcMain.handle("aegis:policy:get", async () => fetchPolicyStatus());
  ipcMain.handle("aegis:policy:set", async (_event, payload: PolicySettings) =>
    applyPolicySettings(payload),
  );
  ipcMain.handle("aegis:policy:open", async () => openPolicyFile());
  ipcMain.handle("aegis:policy:open-folder", async () => openPolicyFolder());

  void emitRuntimeStatus();
  emitProgressStatus();
  void maybeAutoInstallOpenClaw();
  void emitAssetsStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopProcesses();
    app.quit();
  }
});
