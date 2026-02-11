# Projekt Aegis

Projekt Aegis is a Windows-first security shell for OpenClaw. It runs OpenClaw locally, routes all tool actions through a sidecar proxy, and enforces RED/YELLOW/GREEN guardrails with audit logging and user approvals.

## Official Alpha

- Release: `v0.2.3` (official alpha)
- Platform: Windows 10/11
- Runtime model: Aegis installer + first-run managed OpenClaw runtime install
- Recommended distribution artifact: `Projekt Aegis Setup 0.2.3.exe`

## Key Features

- Electron + React control dashboard
- Sidecar controller that proxies all tool actions
- RED/YELLOW/GREEN decision model with blocking approvals
- Alert dashboard with session + lifetime counters
- Audit log (JSONL, newest entries on top, 50 MB rotation with archives)
- Local-only gateway binding (loopback) with token auth
- Provider catalog auto-loaded from OpenClaw models list
- Agentsh-inspired policy heuristics for sensitive files, dangerous commands, and risky env vars
- Gateway-level Lobster workflow monitoring and sanitized audit logging
- Optional policy file overrides with live reload

## Quick Start (Development)

Prerequisites:

- Node.js 22+
- npm 9+ (workspaces)

Install dependencies (repo root):

```bash
npm install
```

Build shared packages:

```bash
npm run build --workspace packages/aegis-core
npm run build --workspace apps/aegis-controller
```

Start the desktop app:

```bash
npm run dev --workspace apps/aegis-desktop
```

The app will spawn OpenClaw locally and the Aegis controller on first start.

## Usage (End User)

1. Install `ProjektAegis_Setup.exe` (NSIS installer).
1. Launch Projekt Aegis.
1. On first launch, Aegis automatically installs OpenClaw into a managed runtime directory.
1. Complete the first-run setup wizard (risk acknowledgement, provider API key, model, access token).
1. Click **Start**.
1. The dashboard will show **Running** and the OpenClaw gateway will bind to `127.0.0.1:18789`.
1. Pair your messaging channel with OpenClaw (QR code shown by OpenClaw UI).
1. If you plan to use browser automation, download the browser assets when prompted (Assets panel).
1. All agent tool actions are routed through Aegis:
   - **GREEN**: executes silently.
   - **YELLOW**: executes and sends a warning message.
   - **RED**: blocks and requests approval. Reply in chat with:
     ```
     /approve <id> allow-once
     ```
1. Use the **Model & Credentials** panel to update providers/models if you hit quota limits.

## Files & Paths

- OpenClaw config: `%APPDATA%/Projekt Aegis/openclaw.json`
- OpenClaw state: `%APPDATA%/Projekt Aegis/openclaw-state/`
- OpenClaw workspace: `%USERPROFILE%/Aegis_Workspace/`
- OpenClaw runtime prefix (managed npm install): `%APPDATA%/Projekt Aegis/runtime/npm-global/`
- Aegis audit log (current session): `%APPDATA%/Projekt Aegis/logs/aegis_audit_<UTC timestamp>.jsonl`
- Aegis audit log archives: `%APPDATA%/Projekt Aegis/logs/Archived_aegis_audit_<UTC timestamp>.jsonl`
- Aegis metrics: `%APPDATA%/Projekt Aegis/metrics.json`
- Aegis policy file (optional): `%APPDATA%/Projekt Aegis/policy.json`
- Log upload endpoint (beta): `https://api.prophettechnology.org/v1/logs/upload`

## Notes

- The OpenClaw gateway is bound to loopback only and requires a token.
- The proxy tool is provided by the `aegis-proxy` OpenClaw plugin.
- Playwright browser assets are excluded from the installer and downloaded on first run via the Assets panel.
- OpenClaw installs automatically via managed npm global install under `%APPDATA%/Projekt Aegis/runtime/npm-global`.
- Runtime preflight auto-repairs missing Node/npm via `winget` before running the OpenClaw installer.
- Legacy Git-checkout runtime artifacts are cleaned before managed install to prevent stale wrapper loops.
- Audit logs rotate at 50 MB by default. The current session log keeps newest events on top; older logs are archived with a timestamped filename.
- Legacy data in `%APPDATA%/aegis-desktop` is auto-migrated on first run.
- Policy file overrides can be toggled on/off in the dashboard.
- Policy file supports JSON (`.json`) or YAML (`.yml`/`.yaml`).
- Channel plugins are auto-enabled so the OpenClaw dashboard can render channel configuration schemas.
- Core filesystem/runtime tools (`exec`, `read`, `write`, `edit`, `list_dir`) execute locally inside the Aegis controller; other tools are proxied to OpenClaw.
- Portable/installer builds do not ship the OpenClaw runtime; it is installed on first run.

## Build (Production)

```bash
npm run build --workspace packages/aegis-core
npm run build --workspace apps/aegis-controller
npm run build --workspace apps/aegis-desktop
npm run dist --workspace apps/aegis-desktop
```

The installer bundles the Aegis controller + UI. The OpenClaw runtime is installed at first run.

### Beta Log Upload Key (Installer Bundling)

For Beta testing, the log upload feature reads a bearer key from:

- `.secrets/prophet-upload-api-beta.key` (repo root, gitignored)

If the file exists at build time, `apps/aegis-desktop/electron-builder.json` bundles it into the installer under `resources/.secrets/`.
The key is never hardcoded in source.

# Building information
Author: Prophet Technology Pte. Ltd.
Description: The One Click AI Sandbox, the mile stone for AGI, created by AI, for AI. Credit: Codex

---

See UPDATE_NOTES.md for build and architecture updates.
