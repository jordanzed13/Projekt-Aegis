import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type AegisSettings = {
  onboardingComplete: boolean;
  gatewayToken?: string;
  provider?: string;
  model?: string;
  communication?: "web" | "messaging";
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

let mainWindow: BrowserWindow | null = null;
let openclawProcess: ChildProcessWithoutNullStreams | null = null;
let controllerProcess: ChildProcessWithoutNullStreams | null = null;
let assetsDownloadProcess: ChildProcessWithoutNullStreams | null = null;
let gatewayToken = "";
let gatewayPort = 18789;
let controllerPort = 18799;
let assetsLastError: string | null = null;
let settings: AegisSettings = { onboardingComplete: false };

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

const getRepoRoot = () => process.cwd();

const resolveSettingsPath = () => path.join(app.getPath("userData"), "aegis-settings.json");

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
    };
  } catch {
    return { onboardingComplete: false };
  }
};

const saveSettings = async (next: AegisSettings) => {
  settings = next;
  await fs.mkdir(path.dirname(resolveSettingsPath()), { recursive: true });
  await fs.writeFile(resolveSettingsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
};

const resolveOpenClawConfigPath = () => path.join(app.getPath("userData"), "openclaw.json");
const resolveOpenClawStateDir = () => path.join(app.getPath("userData"), "openclaw-state");
const resolveWorkspaceDir = () => path.join(app.getPath("userData"), "workspace");
const resolveAuthProfilesPath = (agentId = "main") =>
  path.join(resolveOpenClawStateDir(), "agents", agentId, "agent", "auth-profiles.json");

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

const resolveOpenClawEntry = () => {
  if (isDev) {
    return path.resolve(getRepoRoot(), "openclaw", "openclaw.mjs");
  }
  return path.join(process.resourcesPath, "openclaw", "openclaw.mjs");
};

const resolveOpenClawRoot = () => {
  if (isDev) {
    return path.resolve(getRepoRoot(), "openclaw");
  }
  return path.join(process.resourcesPath, "openclaw");
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

const resolveAssetsRoot = () => path.join(app.getPath("userData"), "assets");

const resolvePlaywrightAssetsPath = () => path.join(resolveAssetsRoot(), "playwright-browsers");

const resolvePlaywrightCli = () => {
  if (isDev) {
    return path.resolve(getRepoRoot(), "openclaw", "node_modules", "playwright-core", "cli.js");
  }
  return path.join(process.resourcesPath, "openclaw", "node_modules", "playwright-core", "cli.js");
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
  next.plugins = {
    ...plugins,
    load: { ...pluginLoad, paths: Array.from(pluginPaths) },
    entries: {
      ...pluginEntries,
      "aegis-proxy": { enabled: true, config: { controllerUrl } },
    },
  };

  const tools = (next.tools as Record<string, unknown> | undefined) ?? {};
  next.tools = {
    ...tools,
    profile: (tools.profile as string | undefined) ?? "minimal",
  };

  const agents = (next.agents as Record<string, unknown> | undefined) ?? {};
  const agentList = Array.isArray(agents.list) ? (agents.list as Record<string, unknown>[]) : [];
  const filtered = agentList.filter((agent) => agent?.id !== "main" && agent?.id !== "aegis-exec");
  const mainAgent: Record<string, unknown> = {
    ...(agentList.find((agent) => agent?.id === "main") ?? {}),
    id: "main",
    default: true,
    tools: { allow: ["aegis_proxy"] },
  };
  if (modelOverride) {
    mainAgent.model = modelOverride;
  }
  const execAgent: Record<string, unknown> = {
    id: "aegis-exec",
    tools: { allow: ["group:openclaw"] },
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
  await ensureGatewayToken();
  const playwrightPath = resolvePlaywrightAssetsPath();
  const stateDir = resolveOpenClawStateDir();
  const configPath = resolveOpenClawConfigPath();
  const controllerUrl = `http://127.0.0.1:${controllerPort}`;
  await fs.mkdir(stateDir, { recursive: true });
  await writeOpenClawConfig(configPath, controllerUrl);

  const openclawEntry = resolveOpenClawEntry();
  const nodePath = resolveNodePath();
  openclawProcess = spawn(nodePath, [openclawEntry, "gateway"], {
    cwd: resolveOpenClawRoot(),
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      OPENCLAW_CONFIG_PATH: configPath,
      PLAYWRIGHT_BROWSERS_PATH: playwrightPath,
    },
  });

  openclawProcess.stdout.on("data", (data) => emitLog(`[openclaw] ${data.toString()}`));
  openclawProcess.stderr.on("data", (data) => emitLog(`[openclaw] ${data.toString()}`));
  openclawProcess.on("exit", () => {
    openclawProcess = null;
  });
};

const startController = async () => {
  if (controllerProcess) {
    return;
  }
  await ensureGatewayToken();
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
    },
  });

  controllerProcess.stdout.on("data", (data) => emitLog(`[controller] ${data.toString()}`));
  controllerProcess.stderr.on("data", (data) => emitLog(`[controller] ${data.toString()}`));
  controllerProcess.on("exit", () => {
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
  const token = payload.gatewayToken?.trim() || settings.gatewayToken || randomUUID();
  gatewayToken = token;
  const nodePath = resolveNodePath();
  const openclawEntry = resolveOpenClawEntry();
  const configPath = resolveOpenClawConfigPath();
  const stateDir = resolveOpenClawStateDir();
  const workspaceDir = resolveWorkspaceDir();
  const args = [
    openclawEntry,
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
  const result = await new Promise<{ code: number | null }>((resolve, reject) => {
    const proc = spawn(nodePath, args, {
      cwd: resolveOpenClawRoot(),
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_GATEWAY_TOKEN: token,
      },
    });
    proc.stdout.on("data", (data) => emitLog(`[onboard] ${data.toString()}`));
    proc.stderr.on("data", (data) => emitLog(`[onboard] ${data.toString()}`));
    proc.on("error", (err) => reject(err));
    proc.on("exit", (code) => resolve({ code }));
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    return { code: null, error: message } as { code: number | null; error: string };
  });

  if ("error" in result && result.error) {
    return { ok: false, error: result.error };
  }
  if (result.code !== 0) {
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
  assetsDownloadProcess = spawn(nodePath, [cliPath, "install", "chromium"], {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
  });

  assetsDownloadProcess.stdout.on("data", (data) => emitLog(`[assets] ${data.toString()}`));
  assetsDownloadProcess.stderr.on("data", (data) => emitLog(`[assets] ${data.toString()}`));
  assetsDownloadProcess.on("error", (err) => {
    assetsLastError = err instanceof Error ? err.message : String(err);
    assetsDownloadProcess = null;
    void emitAssetsStatus();
  });
  assetsDownloadProcess.on("exit", (code) => {
    if (code && code !== 0) {
      assetsLastError = `Playwright browser download failed (code ${code}).`;
    }
    assetsDownloadProcess = null;
    void emitAssetsStatus();
  });

  void emitAssetsStatus();
  return { started: true };
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
  settings = await loadSettings();
  if (settings.gatewayToken) {
    gatewayToken = settings.gatewayToken;
  }
  createWindow();

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
  ipcMain.handle("aegis:assets:status", async () => getAssetsStatus());
  ipcMain.handle("aegis:assets:download", async () => downloadPlaywrightAssets());
  ipcMain.handle("aegis:update-provider", async (_event, payload: UpdateProviderRequest) =>
    updateProviderAndModel(payload),
  );

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
