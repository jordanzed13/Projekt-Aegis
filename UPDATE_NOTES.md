# Update Notes

## 2026-02-06

- Established workspace layout with Electron app, controller service, shared core, and OpenClaw plugin.
- Implemented initial policy engine and audit logging with newest-first JSONL output.
- Added OpenClaw proxy plugin (`aegis_proxy`) and skill guidance for tool routing.
- Scaffolded Electron UI and controller orchestration for local gateway launch.
- Added OpenClaw sidecar configuration template and NSIS packaging skeleton.
- Aligned Electron build outputs with packager expectations and included Node/OpenClaw runtime assets in packaging config.
- Added browser asset download flow and excluded Playwright browser caches from the installer.
- Added first-run setup wizard, OpenClaw onboarding integration, and a dashboard launch button.
- Bundled OpenClaw workspace templates and pinned OpenClaw working directory for reliable onboarding in packaged builds.
- Forced preload to CJS output to prevent renderer bridge failures in the portable build.
- Fixed OpenClaw gateway launch to use env config (removed unsupported --config flag) and normalized default model config shape.
- Enabled Control UI on loopback and bundled controller WebSocket dependency for packaged runs.
- Restricted packaged app files to compiled bundles only to avoid pulling previous build artifacts into app.asar.
- Built and bundled OpenClaw Control UI assets; included @aegis/core + zod runtime deps for the controller.
- Fixed Aegis controller gateway client to use OpenClaw-validated client id/mode for WebSocket connect.
- Added in-app provider update flow to swap API keys/models and restart OpenClaw without rerunning onboarding.
- Cleaned Aegis proxy plugin paths during config overlay to stop duplicate plugin warnings.
- Added session/lifetime alert metrics with JSONL audit log rotation (50 MB cap) and metrics persistence.
- Added controller endpoints for metrics + model catalog, with Aegis dashboard UI for counts/log access.
- Auto-load provider catalog from OpenClaw `models.list` and show model suggestions in the UI.
- Standardized Aegis data, logs, and metrics under `%APPDATA%/Projekt Aegis`.
- Added auto-migration from legacy `%APPDATA%/aegis-desktop` data path on first run.
- Added Agentsh-inspired policy heuristics (sensitive files, dangerous exec/env patterns, workspace-aware flags).
- Added policy file override support with dashboard toggle and live reload.

## 2026-02-07

- Added timestamped audit log filenames and ensured the log file is created on app start.
- Implemented 50 MB audit log rotation with archived log filenames prefixed `Archived_`.
- Updated controller metrics to report the active log file path (post-rotation).
- Tightened tool policy: main agent limited to `session_status` + `aegis_proxy`; exec agent granted core/fs/runtime tool groups.
- Auto-enabled bundled OpenClaw channel plugins so channel configuration schemas render in the dashboard.
- Packaged controller now includes `yaml` dependency; controller HTTP server starts immediately even if gateway is still connecting.
- Improved `aegis_proxy` error messaging when the controller endpoint is unreachable.
- Aegis proxy now aliases common shell calls (`ls`, `dir`, `pwd`, `whoami`) to safe local handlers.
- Global tools profile forced to `full` so the Aegis exec agent can invoke all core tools.
- Added local tool execution inside the Aegis controller for `exec`, `read`, `write`, `edit`, `list_dir`, `pwd`, and `whoami` so core filesystem/runtime tools no longer rely on OpenClaw `tools.invoke`.
- Included OpenClaw pnpm `.pnpm` store in the packaged runtime to prevent missing module errors during onboarding on fresh machines.
