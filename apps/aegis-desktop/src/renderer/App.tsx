import { useEffect, useMemo, useState } from "react";
import type {
  AegisAssetsStatus,
  AegisModelChoice,
  AegisMetricsSnapshot,
  AegisOnboardRequest,
  AegisPolicySettings,
  AegisPolicyStatus,
  AegisProgressStatus,
  AegisRuntimeStatus,
  AegisSetupStatus,
  AegisStatus,
} from "./vite-env";

const initialStatus: AegisStatus = {
  running: false,
  controllerRunning: false,
  openclawRunning: false,
};

const initialAssets: AegisAssetsStatus = {
  playwright: {
    installed: false,
    path: "-",
    downloading: false,
  },
};

const initialRuntime: AegisRuntimeStatus = {
  installed: false,
  path: "-",
  downloading: false,
};

const initialProgress: AegisProgressStatus = {
  active: false,
};

const emptyCounts = {
  green: 0,
  yellow: 0,
  red: 0,
  error: 0,
};

const initialSetup: AegisSetupStatus = {
  onboardingComplete: false,
  gatewayToken: "",
};

const initialPolicyStatus: AegisPolicyStatus = {
  ok: true,
  enabled: false,
  path: "",
  usingFile: false,
  controllerConnected: false,
};

type OnboardFormState = {
  acceptRisk: boolean;
  provider: string;
  apiKey: string;
  model: string;
  communication: "web" | "messaging";
  gatewayToken: string;
};

type ProviderFormState = {
  provider: string;
  apiKey: string;
  model: string;
};

const fallbackProviderOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Google Gemini" },
  { value: "zai", label: "Z.AI" },
  { value: "skip", label: "Skip for now" },
];

const titleCase = (value: string) =>
  value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const providerLabel = (value: string) => {
  const normalized = value.toLowerCase();
  const known: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    zai: "Z.AI",
    qwen: "Qwen",
    minimax: "MiniMax",
    moonshot: "Moonshot",
    kimi: "Kimi",
    venice: "Venice",
    xiaomi: "Xiaomi",
  };
  return known[normalized] ?? titleCase(value);
};

const modelHints: Record<string, string> = {
  openai: "openai/gpt-4.1",
  anthropic: "anthropic/claude-sonnet-4-5",
  openrouter: "openrouter/anthropic/claude-3.7-sonnet",
  gemini: "google/gemini-1.5-pro",
  zai: "zai/glm-4.5",
  qwen: "qwen/qwen2.5-72b-instruct",
  minimax: "minimax/abab-6.5",
  moonshot: "moonshot/moonshot-v1-32k",
  kimi: "moonshot/kimi-latest",
  venice: "venice/venice-2.0",
  xiaomi: "xiaomi/mi-model",
};

export default function App() {
  const [status, setStatus] = useState<AegisStatus>(initialStatus);
  const [assets, setAssets] = useState<AegisAssetsStatus>(initialAssets);
  const [runtime, setRuntime] = useState<AegisRuntimeStatus>(initialRuntime);
  const [progress, setProgress] = useState<AegisProgressStatus>(initialProgress);
  const [setup, setSetup] = useState<AegisSetupStatus>(initialSetup);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [metrics, setMetrics] = useState<AegisMetricsSnapshot>({
    ok: false,
    session: emptyCounts,
    lifetime: emptyCounts,
  });
  const [metricsView, setMetricsView] = useState<"session" | "lifetime">("session");
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string>("-");
  const [policyStatus, setPolicyStatus] = useState<AegisPolicyStatus>(initialPolicyStatus);
  const [policyForm, setPolicyForm] = useState<AegisPolicySettings>({
    enabled: false,
    path: "",
  });
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [modelCatalog, setModelCatalog] = useState<AegisModelChoice[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [form, setForm] = useState<OnboardFormState>({
    acceptRisk: false,
    provider: "openai",
    apiKey: "",
    model: "",
    communication: "web",
    gatewayToken: "",
  });
  const [providerForm, setProviderForm] = useState<ProviderFormState>({
    provider: "openai",
    apiKey: "",
    model: "",
  });

  const bridgeReady = typeof window !== "undefined" && Boolean(window.aegis);

  useEffect(() => {
    if (!bridgeReady) {
      return;
    }
    let mounted = true;
    window.aegis.status().then((next) => {
      if (mounted) {
        setStatus(next);
      }
    });
    window.aegis.assetsStatus().then((next) => {
      if (mounted) {
        setAssets(next);
      }
    });
    window.aegis.runtimeStatus().then((next) => {
      if (mounted) {
        setRuntime(next);
      }
    });
    window.aegis.progressStatus().then((next) => {
      if (mounted) {
        setProgress(next);
      }
    });
    window.aegis.setupStatus().then((next) => {
      if (mounted) {
        setSetup(next);
        setForm((prev) => ({
          ...prev,
          gatewayToken: next.gatewayToken || prev.gatewayToken,
        }));
      }
    });
    window.aegis.logPath().then((next) => {
      if (mounted && next?.path) {
        setLogPath(next.path);
      }
    });
    window.aegis.policyStatus().then((next) => {
      if (mounted && next) {
        setPolicyStatus(next);
        setPolicyForm({ enabled: next.enabled, path: next.path });
      }
    });
    const unsubscribe = window.aegis.onLog((line) => {
      setLogs((prev) => [line, ...prev].slice(0, 500));
    });
    const unsubscribeAssets = window.aegis.onAssetsStatus((next) => {
      setAssets(next);
    });
    const unsubscribeRuntime = window.aegis.onRuntimeStatus((next) => {
      setRuntime(next);
      setRuntimeError(next.lastError ?? null);
    });
    const unsubscribeProgress = window.aegis.onProgress((next) => {
      setProgress(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeAssets();
      unsubscribeRuntime();
      unsubscribeProgress();
    };
  }, [bridgeReady]);

  useEffect(() => {
    if (!bridgeReady) {
      return;
    }
    let active = true;
    const loadModels = async () => {
      const result = await window.aegis.models();
      if (!active) {
        return;
      }
      if (result.ok) {
        setModelCatalog(result.models ?? []);
        setModelsError(null);
      } else {
        setModelsError(result.error ?? "Unable to load models.");
      }
    };
    void loadModels();
    return () => {
      active = false;
    };
  }, [bridgeReady, status.openclawRunning]);

  useEffect(() => {
    if (!bridgeReady) {
      return;
    }
    let active = true;
    const loadMetrics = async () => {
      const result = await window.aegis.metrics();
      if (!active) {
        return;
      }
      if (result.ok) {
        setMetrics(result);
        if (result.logPath) {
          setLogPath(result.logPath);
        }
        setMetricsError(null);
      } else {
        setMetricsError(result.error ?? "Unable to load metrics.");
      }
    };
    void loadMetrics();
    const timer = setInterval(loadMetrics, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bridgeReady, status.controllerRunning]);

  useEffect(() => {
    if (!bridgeReady) {
      return;
    }
    let active = true;
    const loadPolicy = async () => {
      const result = await window.aegis.policyStatus();
      if (!active) {
        return;
      }
      setPolicyStatus(result);
      setPolicyError(result.ok ? null : result.lastError ?? "Unable to load policy status.");
      setPolicyForm((prev) => {
        if (prev.path && prev.path !== result.path) {
          return prev;
        }
        if (prev.enabled === result.enabled && prev.path === result.path) {
          return prev;
        }
        return { enabled: result.enabled, path: result.path };
      });
    };
    void loadPolicy();
    const timer = setInterval(loadPolicy, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bridgeReady, status.controllerRunning]);

  const providerChoices = useMemo(() => {
    if (modelCatalog.length === 0) {
      return fallbackProviderOptions.filter((option) => option.value !== "skip");
    }
    const providers = Array.from(new Set(modelCatalog.map((model) => model.provider))).sort();
    return providers.map((provider) => ({ value: provider, label: providerLabel(provider) }));
  }, [modelCatalog]);

  const wizardProviderOptions = useMemo(() => {
    const hasSkip = providerChoices.some((option) => option.value === "skip");
    if (hasSkip) {
      return providerChoices;
    }
    return [...providerChoices, { value: "skip", label: "Skip for now" }];
  }, [providerChoices]);

  const modelPlaceholder = useMemo(
    () => modelHints[form.provider] ?? "provider/model",
    [form.provider],
  );
  const providerModelPlaceholder = useMemo(
    () => modelHints[providerForm.provider] ?? "provider/model",
    [providerForm.provider],
  );
  const wizardModelOptions = useMemo(
    () =>
      modelCatalog
        .filter((model) => model.provider === form.provider)
        .map((model) => model.id),
    [modelCatalog, form.provider],
  );
  const providerModelOptions = useMemo(
    () =>
      modelCatalog
        .filter((model) => model.provider === providerForm.provider)
        .map((model) => model.id),
    [modelCatalog, providerForm.provider],
  );

  useEffect(() => {
    if (!showProviderForm) {
      setProviderForm((prev) => ({
        provider: setup.provider ?? prev.provider,
        apiKey: "",
        model: setup.model ?? prev.model,
      }));
    }
  }, [setup.provider, setup.model, showProviderForm]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const next = await window.aegis.start();
      setStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const next = await window.aegis.stop();
      setStatus(next);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDashboard = async () => {
    await window.aegis.openDashboard();
  };

  const handleDownloadAssets = async () => {
    setAssetsBusy(true);
    try {
      const result = await window.aegis.downloadBrowserAssets();
      if (!result.started && result.message) {
        setLogs((prev) => [`[assets] ${result.message}`, ...prev].slice(0, 500));
      }
    } finally {
      setAssetsBusy(false);
    }
  };

  const handleDownloadRuntime = async () => {
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      const result = await window.aegis.downloadRuntime({ method: "git" });
      if (!result.started && result.message) {
        setRuntimeError(result.message);
      }
    } finally {
      setRuntimeBusy(false);
    }
  };

  const handleOpenLog = async () => {
    await window.aegis.openLog();
  };

  const handleOpenLogFolder = async () => {
    await window.aegis.openLogFolder();
  };

  const handlePolicySave = async () => {
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      const result = await window.aegis.policyUpdate({
        enabled: policyForm.enabled,
        path: policyForm.path,
      });
      setPolicyStatus(result);
      setPolicyForm({ enabled: result.enabled, path: result.path });
      if (!result.ok) {
        setPolicyError(result.lastError ?? "Policy update failed.");
      }
    } finally {
      setPolicyBusy(false);
    }
  };

  const handlePolicyReset = () => {
    setPolicyForm({ enabled: policyStatus.enabled, path: policyStatus.path });
  };

  const handleOpenPolicyFile = async () => {
    await window.aegis.openPolicyFile();
  };

  const handleOpenPolicyFolder = async () => {
    await window.aegis.openPolicyFolder();
  };

  const handleOnboard = async () => {
    setOnboardBusy(true);
    setOnboardError(null);
    try {
      const payload: AegisOnboardRequest = {
        acceptRisk: form.acceptRisk,
        provider: form.provider,
        apiKey: form.provider === "skip" ? undefined : form.apiKey,
        model: form.model.trim() || undefined,
        gatewayToken: form.gatewayToken.trim() || undefined,
        communication: form.communication,
      };
      const result = await window.aegis.onboard(payload);
      if (!result.ok) {
        setOnboardError(result.error ?? "Onboarding failed.");
        return;
      }
      if (result.status) {
        setStatus(result.status);
      }
      if (result.setup) {
        setSetup(result.setup);
      }
      setForm((prev) => ({ ...prev, apiKey: "" }));
    } finally {
      setOnboardBusy(false);
    }
  };

  const handleProviderUpdate = async () => {
    setProviderBusy(true);
    setProviderError(null);
    try {
      const result = await window.aegis.updateProvider({
        provider: providerForm.provider,
        apiKey: providerForm.apiKey,
        model: providerForm.model.trim() || undefined,
      });
      if (!result.ok) {
        setProviderError(result.error ?? "Provider update failed.");
        return;
      }
      if (result.setup) {
        setSetup(result.setup);
      } else {
        const refreshed = await window.aegis.setupStatus();
        setSetup(refreshed);
      }
      setProviderForm((prev) => ({ ...prev, apiKey: "" }));
      setShowProviderForm(false);
    } finally {
      setProviderBusy(false);
    }
  };

  const generateToken = () => {
    const token = typeof crypto !== "undefined" ? crypto.randomUUID() : "";
    if (token) {
      setForm((prev) => ({ ...prev, gatewayToken: token }));
    }
  };

  const activeCounts =
    metricsView === "session" ? metrics.session ?? emptyCounts : metrics.lifetime ?? emptyCounts;

  const activeProgress = useMemo<AegisProgressStatus>(() => {
    if (progress.active) {
      return progress;
    }
    if (runtime.downloading || runtimeBusy) {
      return {
        active: true,
        task: "runtime",
        message: "Installing OpenClaw runtime...",
      };
    }
    if (onboardBusy) {
      return {
        active: true,
        task: "onboard",
        message: "Running onboarding...",
      };
    }
    if (assets.playwright.downloading || assetsBusy) {
      return {
        active: true,
        task: "assets",
        message: "Downloading browser assets...",
      };
    }
    return { active: false };
  }, [progress, runtime.downloading, runtimeBusy, onboardBusy, assets.playwright.downloading, assetsBusy]);

  const progressLabel = useMemo(() => {
    if (!activeProgress.task) {
      return "Working";
    }
    const labels: Record<NonNullable<AegisProgressStatus["task"]>, string> = {
      runtime: "Runtime",
      onboard: "Onboarding",
      assets: "Assets",
    };
    return labels[activeProgress.task];
  }, [activeProgress.task]);

  const runtimeReady = runtime.installed;

  const stepBlocked =
    (step === 0 && !form.acceptRisk) ||
    (step === 1 && form.provider !== "skip" && !form.apiKey.trim()) ||
    (step === 2 && !form.model.trim()) ||
    (step === 4 && (!form.gatewayToken.trim() || !runtimeReady || runtime.downloading));

  const progressPanel = activeProgress.active ? (
    <section className="panel progress-panel">
      <div className="panel-title">{progressLabel} Progress</div>
      <div className="progress-copy">{activeProgress.message ?? "Working..."}</div>
      <div className="progress-track">
        {typeof activeProgress.value === "number" ? (
          <div
            className="progress-fill"
            style={{ width: `${Math.max(0, Math.min(100, activeProgress.value))}%` }}
          />
        ) : (
          <div className="progress-fill indeterminate" />
        )}
      </div>
      {typeof activeProgress.value === "number" && (
        <div className="progress-meta">{Math.round(activeProgress.value)}%</div>
      )}
    </section>
  ) : null;

  const runtimePanel = (
    <section className="panel">
      <div className="panel-title">OpenClaw Runtime</div>
      <p className="muted">
        OpenClaw is automatically installed on first run using the official installer script.
        You can re-run the installer here.
      </p>
      {!runtime.installed && (
        <div className="assets-callout">
          <div className="assets-callout-title">OpenClaw runtime not installed.</div>
          <div className="assets-callout-body">
            Installation will start automatically. You can also click Install to retry.
          </div>
        </div>
      )}
      <p className="muted">Install source: GitHub (`openclaw/openclaw`, git mode).</p>
      <div className="buttons">
        <button
          className="primary"
          onClick={handleDownloadRuntime}
          disabled={runtimeBusy || runtime.downloading}
        >
          {runtime.downloading
            ? "Installing..."
            : runtime.installed
              ? "Reinstall OpenClaw"
              : "Install OpenClaw"}
        </button>
      </div>
      <div className="status-grid">
        <div>Installed: {runtime.installed ? "yes" : "no"}</div>
        <div>Runtime Path: {runtime.path}</div>
        <div>Method: {runtime.method ?? "git"}</div>
        <div>Installed At: {runtime.installedAt ?? "-"}</div>
      </div>
      {runtime.lastError && (
        <div className="assets-error">Runtime error: {runtime.lastError}</div>
      )}
      {runtimeError && <div className="assets-error">Runtime error: {runtimeError}</div>}
    </section>
  );

  if (!bridgeReady) {
    return (
      <div className="app">
        <header className="header">
          <div>
            <h1>Projekt Aegis</h1>
            <p>Secure OpenClaw Sandbox Controller</p>
          </div>
        </header>
        <section className="panel">
          <div className="panel-title">Renderer Bridge Missing</div>
          <p className="muted">
            The preload bridge did not initialize, so the dashboard cannot load. Verify the
            packaged preload file and rebuild.
          </p>
        </section>
      </div>
    );
  }

  if (!setup.onboardingComplete) {
    return (
      <div className="app">
      <header className="header">
        <div>
          <h1>Projekt Aegis</h1>
          <p>Production-ready OpenClaw deployment &amp; sandbox</p>
        </div>
      </header>

      {progressPanel}

      {runtimePanel}

      <section className="panel">
        <div className="panel-title">Setup Wizard</div>
          <div className="wizard-steps">
            {["Acknowledge", "Provider", "Model", "Communication", "Access"].map((label, idx) => (
              <div key={label} className={`wizard-step ${step === idx ? "active" : ""}`}>
                {idx + 1}. {label}
              </div>
            ))}
          </div>

          {step === 0 && (
            <div className="wizard-panel">
              <h2>Powerful System Notice</h2>
              <p>
                Projekt Aegis can execute actions on your machine and relay messages through
                OpenClaw. Only proceed if you understand the risks and will supervise the agent.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.acceptRisk}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, acceptRisk: event.target.checked }))
                  }
                />
                I acknowledge this system is powerful and will supervise it.
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-panel">
              <h2>Model Provider</h2>
              <div className="form-grid">
                <label className="form-field">
                  Provider
                  <select
                    value={form.provider}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, provider: event.target.value }))
                    }
                  >
                    {wizardProviderOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.provider !== "skip" && (
                  <label className="form-field">
                    API Key
                    <input
                      type="password"
                      placeholder="Paste your API key"
                      value={form.apiKey}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, apiKey: event.target.value }))
                      }
                    />
                  </label>
                )}
              </div>
              <p className="muted">
                We store provider credentials in your local OpenClaw config so they can be reused
                securely on this machine.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-panel">
              <h2>Default Model</h2>
              <label className="form-field">
                Model ID
                <input
                  type="text"
                  placeholder={modelPlaceholder}
                  list="wizard-model-options"
                  value={form.model}
                  onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                />
                <datalist id="wizard-model-options">
                  {wizardModelOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
              <p className="muted">
                Use the <code>provider/model</code> format. You can change this later in the
                OpenClaw dashboard.
              </p>
              {modelsError && (
                <p className="muted">Model catalog unavailable: {modelsError}</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="wizard-panel">
              <h2>Communication Path</h2>
              <label className="radio">
                <input
                  type="radio"
                  name="communication"
                  value="web"
                  checked={form.communication === "web"}
                  onChange={() => setForm((prev) => ({ ...prev, communication: "web" }))}
                />
                Use the local OpenClaw dashboard (recommended)
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="communication"
                  value="messaging"
                  checked={form.communication === "messaging"}
                  onChange={() => setForm((prev) => ({ ...prev, communication: "messaging" }))}
                />
                Configure messaging apps later in the dashboard
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-panel">
              <h2>Gateway Access Token</h2>
              <label className="form-field">
                Token (used like a password)
                <input
                  type="text"
                  placeholder="Generate or paste a token"
                  value={form.gatewayToken}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, gatewayToken: event.target.value }))
                  }
                />
              </label>
              <div className="buttons">
                <button className="ghost" onClick={generateToken}>
                  Generate Token
                </button>
              </div>
              <p className="muted">
                This token secures the OpenClaw dashboard on localhost. Keep it private.
              </p>
            </div>
          )}

          {!runtimeReady && step === 4 && (
            <div className="assets-error">
              Download the OpenClaw runtime before completing setup.
            </div>
          )}
          {onboardError && <div className="assets-error">Setup failed: {onboardError}</div>}

          <div className="wizard-actions">
            <button className="ghost" onClick={() => setStep(Math.max(step - 1, 0))} disabled={step === 0}>
              Back
            </button>
            {step < 4 ? (
              <button
                className="primary"
                onClick={() => setStep(Math.min(step + 1, 4))}
                disabled={stepBlocked}
              >
                Continue
              </button>
            ) : (
              <button className="primary" onClick={handleOnboard} disabled={stepBlocked || onboardBusy}>
                {onboardBusy ? "Configuring..." : "Finish & Start"}
              </button>
            )}
          </div>
        </section>

        <section className="panel log-panel">
          <div className="panel-title">Activity Log</div>
          <div className="log">
            {logs.length === 0 ? (
              <div className="log-empty">Setup logs will appear here.</div>
            ) : (
              logs.map((line, idx) => (
                <div className="log-line" key={`${line}-${idx}`}>
                  {line}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Projekt Aegis</h1>
          <p>Secure OpenClaw Sandbox Controller</p>
        </div>
        <div className={`status ${status.running ? "ok" : "idle"}`}>
          {status.running ? "Running" : "Stopped"}
        </div>
      </header>

      {progressPanel}

      <section className="panel">
        <div className="panel-title">Control</div>
        <div className="buttons">
          <button
            className="primary"
            onClick={handleStart}
            disabled={busy || status.running || !runtime.installed || runtime.downloading}
          >
            Start
          </button>
          <button className="ghost" onClick={handleStop} disabled={busy || !status.running}>
            Stop
          </button>
          <button
            className="ghost"
            onClick={handleOpenDashboard}
            disabled={!status.openclawRunning}
          >
            Open OpenClaw Dashboard
          </button>
        </div>
        <div className="status-grid">
          <div>Controller: {status.controllerRunning ? "online" : "offline"}</div>
          <div>OpenClaw: {status.openclawRunning ? "online" : "offline"}</div>
          <div>Gateway Port: {status.gatewayPort ?? "-"}</div>
          <div>Runtime: {runtime.installed ? "installed" : "missing"}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">Setup Summary</div>
        <div className="status-grid">
          <div>Provider: {setup.provider ?? "not set"}</div>
          <div>Model: {setup.model ?? "not set"}</div>
          <div>Communication: {setup.communication ?? "web"}</div>
          <div>Dashboard URL: {setup.dashboardUrl ?? "-"}</div>
        </div>
      </section>

      {runtimePanel}

      <section className="panel">
        <div className="panel-title">Policy File</div>
        <p className="muted">
          Enable a local policy file to override Aegis risk rules (sensitive files, command
          patterns, env filters). Changes apply immediately if the controller is running.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={policyForm.enabled}
            onChange={(event) =>
              setPolicyForm((prev) => ({ ...prev, enabled: event.target.checked }))
            }
          />
          Use policy file overrides
        </label>
        <div className="form-grid">
          <label className="form-field">
            Policy File Path
            <input
              type="text"
              placeholder="C:\\Users\\<you>\\AppData\\Roaming\\Projekt Aegis\\policy.json"
              value={policyForm.path}
              onChange={(event) => setPolicyForm((prev) => ({ ...prev, path: event.target.value }))}
            />
          </label>
        </div>
        <div className="buttons">
          <button className="primary" onClick={handlePolicySave} disabled={policyBusy}>
            {policyBusy ? "Applying..." : "Apply Policy"}
          </button>
          <button className="ghost" onClick={handlePolicyReset} disabled={policyBusy}>
            Reset
          </button>
          <button className="ghost" onClick={handleOpenPolicyFile}>
            Open Policy File
          </button>
          <button className="ghost" onClick={handleOpenPolicyFolder}>
            Open Policy Folder
          </button>
        </div>
        <div className="status-grid">
          <div>Controller: {policyStatus.controllerConnected ? "connected" : "offline"}</div>
          <div>Policy Source: {policyStatus.usingFile ? "file" : "default"}</div>
          <div>Last Loaded: {policyStatus.lastLoadedAt ?? "-"}</div>
          <div>Workspace Root: {policyStatus.workspaceRoot ?? "-"}</div>
        </div>
        {policyError && <div className="assets-error">Policy error: {policyError}</div>}
      </section>

      <section className="panel">
        <div className="panel-title">Alerts & Metrics</div>
        <div className="buttons">
          <button
            className="ghost"
            onClick={() =>
              setMetricsView((prev) => (prev === "session" ? "lifetime" : "session"))
            }
          >
            Viewing: {metricsView === "session" ? "Session" : "Lifetime"}
          </button>
          <button className="ghost" onClick={handleOpenLog}>
            Open Log File
          </button>
          <button className="ghost" onClick={handleOpenLogFolder}>
            Open Log Folder
          </button>
        </div>
        <div className="status-grid">
          <div>Green: {activeCounts.green}</div>
          <div>Yellow: {activeCounts.yellow}</div>
          <div>Red: {activeCounts.red}</div>
          <div>Error: {activeCounts.error}</div>
          <div>Log Path: {logPath}</div>
        </div>
        {metricsError && <div className="assets-error">Metrics error: {metricsError}</div>}
      </section>

      <section className="panel">
        <div className="panel-title">Model & Credentials</div>
        <p className="muted">
          If the OpenClaw dashboard shows blank replies, it usually means the provider is rate
          limited or out of quota. Update the API key or switch providers here.
        </p>
        {modelsError && <p className="muted">Model catalog unavailable: {modelsError}</p>}
        <div className="buttons">
          <button className="ghost" onClick={() => setShowProviderForm((prev) => !prev)}>
            {showProviderForm ? "Close" : "Update Provider"}
          </button>
        </div>
        {showProviderForm && (
          <div className="provider-form">
            <div className="form-grid">
              <label className="form-field">
                Provider
                <select
                  value={providerForm.provider}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, provider: event.target.value }))
                  }
                >
                  {providerChoices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                API Key
                <input
                  type="password"
                  placeholder="Paste a valid API key"
                  value={providerForm.apiKey}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, apiKey: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                Default Model
                <input
                  type="text"
                  placeholder={providerModelPlaceholder}
                  list="provider-model-options"
                  value={providerForm.model}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, model: event.target.value }))
                  }
                />
                <datalist id="provider-model-options">
                  {providerModelOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
            </div>
            {providerError && <div className="assets-error">Update failed: {providerError}</div>}
            <div className="buttons">
              <button
                className="primary"
                onClick={handleProviderUpdate}
                disabled={providerBusy || !providerForm.apiKey.trim()}
              >
                {providerBusy ? "Updating..." : "Apply & Restart"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel assets-panel">
        <div className="panel-title">Assets</div>
        {!assets.playwright.installed && (
          <div className="assets-callout">
            <div className="assets-callout-title">Browser automation assets are not installed.</div>
            <div className="assets-callout-body">
              Download the Playwright Chromium runtime to enable browser tools in OpenClaw.
            </div>
            <div className="buttons">
              <button
                className="primary"
                onClick={handleDownloadAssets}
                disabled={assetsBusy || assets.playwright.downloading || !runtime.installed}
              >
                {assets.playwright.downloading ? "Downloading..." : "Download Browser Assets"}
              </button>
            </div>
            {!runtime.installed && (
              <div className="assets-callout-body">
                Install the OpenClaw runtime first to enable browser downloads.
              </div>
            )}
          </div>
        )}
        {assets.playwright.installed && (
          <div className="assets-summary">
            Browser assets are installed.
            <button
              className="ghost"
              onClick={handleDownloadAssets}
              disabled={assetsBusy || assets.playwright.downloading || !runtime.installed}
            >
              {assets.playwright.downloading ? "Downloading..." : "Re-download"}
            </button>
          </div>
        )}
        <div className="status-grid">
          <div>Browser Assets: {assets.playwright.installed ? "installed" : "missing"}</div>
          <div>Install Path: {assets.playwright.path}</div>
        </div>
        {assets.playwright.lastError && (
          <div className="assets-error">Download failed: {assets.playwright.lastError}</div>
        )}
      </section>

      <section className="panel log-panel">
        <div className="panel-title">Activity Log</div>
        <div className="log">
          {logs.length === 0 ? (
            <div className="log-empty">Logs will appear here.</div>
          ) : (
            logs.map((line, idx) => (
              <div className="log-line" key={`${line}-${idx}`}>
                {line}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
