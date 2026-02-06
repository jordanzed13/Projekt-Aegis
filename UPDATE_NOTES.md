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
