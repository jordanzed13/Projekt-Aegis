export type AegisStatus = {
  running: boolean;
  controllerRunning: boolean;
  openclawRunning: boolean;
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
      assetsStatus: () => Promise<AegisAssetsStatus>;
      downloadBrowserAssets: () => Promise<AegisAssetsDownloadResult>;
      onLog: (handler: (line: string) => void) => () => void;
      onAssetsStatus: (handler: (status: AegisAssetsStatus) => void) => () => void;
    };
  }
}

export {};
