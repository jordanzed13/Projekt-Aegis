export type AegisStatus = {
  running: boolean;
  controllerRunning: boolean;
  openclawRunning: boolean;
  openclawState: "offline" | "starting" | "online";
  gatewayPort?: number;
};

export type AegisSetupStatus = {
  onboardingComplete: boolean;
  gatewayToken: string;
  provider?: string;
  model?: string;
  communication?: "web" | "messaging";
  dashboardUrl?: string;
};

export type AegisOnboardRequest = {
  acceptRisk: boolean;
  provider: string;
  apiKey?: string;
  model?: string;
  gatewayToken?: string;
  communication?: "web" | "messaging";
};

export type AegisOnboardResult = {
  ok: boolean;
  error?: string;
  status?: AegisStatus;
  setup?: AegisSetupStatus;
};

export type AegisUpdateProviderRequest = {
  provider: string;
  apiKey?: string;
  model?: string;
};

export type AegisUpdateProviderResult = {
  ok: boolean;
  error?: string;
  setup?: AegisSetupStatus;
};

export type AegisAssetsStatus = {
  playwright: {
    installed: boolean;
    path: string;
    downloading: boolean;
    lastError?: string;
  };
};

export type AegisAssetsDownloadResult = {
  started: boolean;
  message?: string;
};

export type AegisRuntimeStatus = {
  installed: boolean;
  path: string;
  downloading: boolean;
  lastError?: string;
  method?: "git" | "npm";
  installedAt?: string;
};

export type AegisRuntimeInstallRequest = {
  method?: "git" | "npm";
};

export type AegisRuntimeInstallResult = {
  started: boolean;
  message?: string;
};

export type AegisProgressStatus = {
  active: boolean;
  task?: "runtime" | "onboard" | "assets";
  message?: string;
  value?: number;
};

export type AegisAlertCounts = {
  green: number;
  yellow: number;
  red: number;
  error: number;
};

export type AegisMetricsSnapshot = {
  ok: boolean;
  session?: AegisAlertCounts;
  lifetime?: AegisAlertCounts;
  logPath?: string;
  error?: string;
};

export type AegisModelChoice = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
};

export type AegisModelsResult = {
  ok: boolean;
  models: AegisModelChoice[];
  error?: string;
};

export type AegisLogPathResult = {
  path: string;
};

export type AegisLogUploadResult = {
  ok: boolean;
  message: string;
  uploadedAt?: string;
};

export type AegisPolicySettings = {
  enabled: boolean;
  path: string;
};

export type AegisPolicyStatus = AegisPolicySettings & {
  ok: boolean;
  usingFile: boolean;
  controllerConnected: boolean;
  lastLoadedAt?: string;
  lastError?: string;
  workspaceRoot?: string;
};

declare global {
  interface Window {
    aegis: {
      start: () => Promise<AegisStatus>;
      stop: () => Promise<AegisStatus>;
      status: () => Promise<AegisStatus>;
      setupStatus: () => Promise<AegisSetupStatus>;
      onboard: (payload: AegisOnboardRequest) => Promise<AegisOnboardResult>;
      updateProvider: (payload: AegisUpdateProviderRequest) => Promise<AegisUpdateProviderResult>;
      openDashboard: () => Promise<{ url?: string }>;
      runtimeStatus: () => Promise<AegisRuntimeStatus>;
      downloadRuntime: (payload: AegisRuntimeInstallRequest) => Promise<AegisRuntimeInstallResult>;
      progressStatus: () => Promise<AegisProgressStatus>;
      assetsStatus: () => Promise<AegisAssetsStatus>;
      downloadBrowserAssets: () => Promise<AegisAssetsDownloadResult>;
      metrics: () => Promise<AegisMetricsSnapshot>;
      models: () => Promise<AegisModelsResult>;
      logPath: () => Promise<AegisLogPathResult>;
      openLog: () => Promise<AegisLogPathResult>;
      openLogFolder: () => Promise<AegisLogPathResult>;
      openHelpGuide: () => Promise<AegisLogPathResult>;
      uploadLogs: () => Promise<AegisLogUploadResult>;
      policyStatus: () => Promise<AegisPolicyStatus>;
      policyUpdate: (payload: AegisPolicySettings) => Promise<AegisPolicyStatus>;
      openPolicyFile: () => Promise<AegisLogPathResult>;
      openPolicyFolder: () => Promise<AegisLogPathResult>;
      onLog: (handler: (line: string) => void) => () => void;
      onStatus: (handler: (status: AegisStatus) => void) => () => void;
      onAssetsStatus: (handler: (status: AegisAssetsStatus) => void) => () => void;
      onRuntimeStatus: (handler: (status: AegisRuntimeStatus) => void) => () => void;
      onProgress: (handler: (status: AegisProgressStatus) => void) => () => void;
    };
  }
}

export {};
