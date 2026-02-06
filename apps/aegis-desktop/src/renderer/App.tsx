import { useEffect, useMemo, useState } from "react";
import type {
  AegisAssetsStatus,
  AegisOnboardRequest,
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

const initialSetup: AegisSetupStatus = {
  onboardingComplete: false,
  gatewayToken: "",
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

const providerOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Google Gemini" },
  { value: "zai", label: "Z.AI" },
  { value: "skip", label: "Skip for now" },
];

const modelHints: Record<string, string> = {
  openai: "openai/gpt-4.1",
  anthropic: "anthropic/claude-sonnet-4-5",
  openrouter: "openrouter/anthropic/claude-3.7-sonnet",
  gemini: "google/gemini-1.5-pro",
  zai: "zai/glm-4.5",
};

export default function App() {
  const [status, setStatus] = useState<AegisStatus>(initialStatus);
  const [assets, setAssets] = useState<AegisAssetsStatus>(initialAssets);
  const [setup, setSetup] = useState<AegisSetupStatus>(initialSetup);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [step, setStep] = useState(0);
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
    window.aegis.setupStatus().then((next) => {
      if (mounted) {
        setSetup(next);
        setForm((prev) => ({
          ...prev,
          gatewayToken: next.gatewayToken || prev.gatewayToken,
        }));
      }
    });
    const unsubscribe = window.aegis.onLog((line) => {
      setLogs((prev) => [line, ...prev].slice(0, 500));
    });
    const unsubscribeAssets = window.aegis.onAssetsStatus((next) => {
      setAssets(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeAssets();
    };
  }, [bridgeReady]);

  const modelPlaceholder = useMemo(
    () => modelHints[form.provider] ?? "provider/model",
    [form.provider],
  );
  const providerModelPlaceholder = useMemo(
    () => modelHints[providerForm.provider] ?? "provider/model",
    [providerForm.provider],
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

  const stepBlocked =
    (step === 0 && !form.acceptRisk) ||
    (step === 1 && form.provider !== "skip" && !form.apiKey.trim()) ||
    (step === 2 && !form.model.trim()) ||
    (step === 4 && !form.gatewayToken.trim());

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
                    {providerOptions.map((option) => (
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
                  value={form.model}
                  onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                />
              </label>
              <p className="muted">
                Use the <code>provider/model</code> format. You can change this later in the
                OpenClaw dashboard.
              </p>
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

      <section className="panel">
        <div className="panel-title">Control</div>
        <div className="buttons">
          <button className="primary" onClick={handleStart} disabled={busy || status.running}>
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

      <section className="panel">
        <div className="panel-title">Model & Credentials</div>
        <p className="muted">
          If the OpenClaw dashboard shows blank replies, it usually means the provider is rate
          limited or out of quota. Update the API key or switch providers here.
        </p>
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
                  {providerOptions
                    .filter((option) => option.value !== "skip")
                    .map((option) => (
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
                  value={providerForm.model}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, model: event.target.value }))
                  }
                />
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
                disabled={assetsBusy || assets.playwright.downloading}
              >
                {assets.playwright.downloading ? "Downloading..." : "Download Browser Assets"}
              </button>
            </div>
          </div>
        )}
        {assets.playwright.installed && (
          <div className="assets-summary">
            Browser assets are installed.
            <button
              className="ghost"
              onClick={handleDownloadAssets}
              disabled={assetsBusy || assets.playwright.downloading}
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
