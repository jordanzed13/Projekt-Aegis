# Projekt Aegis

Projekt Aegis is a Windows-first security shell for OpenClaw. It runs OpenClaw locally, routes all tool actions through a sidecar proxy, and enforces RED/YELLOW/GREEN guardrails with audit logging and user approvals.

## Key Features

- Electron + React control dashboard
- Sidecar controller that proxies all tool actions
- RED/YELLOW/GREEN decision model with blocking approvals
- Audit log with newest entries on top
- Local-only gateway binding (loopback) with token auth

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

## Files & Paths

- OpenClaw config: `%APPDATA%/Projekt Aegis/openclaw.json`
- OpenClaw state: `%APPDATA%/Projekt Aegis/openclaw-state/`
- Aegis audit log: `%USERPROFILE%/.projekt-aegis/logs/aegis_audit_log.jsonl`

## Notes

- The OpenClaw gateway is bound to loopback only and requires a token.
- The proxy tool is provided by the `aegis-proxy` OpenClaw plugin.
- Playwright browser assets are excluded from the installer and downloaded on first run via the Assets panel.

## Build (Production)

```bash
npm run build --workspace packages/aegis-core
npm run build --workspace apps/aegis-controller
npm run build --workspace apps/aegis-desktop
npm run dist --workspace apps/aegis-desktop
```

The installer will include the OpenClaw runtime and Aegis controller bundle.

# Building information
Author: Prophet Technology Pte. Ltd.
Description: The One Click AI Sandbox, the mile stone for AGI, created by AI, for AI. Credit: Codex

---

See UPDATE_NOTES.md for build and architecture updates.
