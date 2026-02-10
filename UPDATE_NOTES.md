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
- Materialized OpenClaw `node_modules` into real directories for portable builds (avoids missing-module errors when pnpm junctions are lost in ZIP distribution).

## 2026-02-08

- Official alpha release finalized: `v0.1.15`.
- Alpha release baseline: installer-first flow, managed runtime install, runtime health-gated startup, and stable dashboard launch path.
- Switched portable builds to auto-install OpenClaw on first run using the official installer script.
- Added Runtime panel with auto-install status and manual reinstall action.
- Wired runtime status IPC events so the UI can block onboarding/start until OpenClaw is installed.
- Added runtime preflight that repairs Node/npm and Git via `winget` before invoking `install.ps1`, removing the automatic fallback to npm when Git is missing.
- Fixed OpenClaw launch priority to prefer local `openclaw.mjs` entrypoint over global `openclaw.cmd`, preventing `dist/entry.js` module-not-found onboarding failures on some machines.
- Added fallback model catalog when controller is not yet reachable so onboarding step 3 no longer blocks on transient fetch errors.
- Tightened runtime validity check: installation now requires both `openclaw.mjs` and `dist/entry.js`.
- Added automatic installer fallback from git source install to npm package install when git checkout is incomplete (missing build output).
- Fixed runtime false-negative after successful install: validation now also accepts `openclaw --version` via PATH (not only fixed `.cmd` paths), and launcher can run via PATH-resolved CLI when needed.
- Fixed runtime detection edge case where a stale first `openclaw.cmd` candidate could block setup even when another wrapper path is healthy; CLI validation now checks all discovered wrappers.
- Added in-app progress bar for long-running tasks (runtime install, onboarding, browser asset download) with live stage updates.
- Fixed runtime install completion on machines where installer reports success but process can hang: added installer success markers + idle watchdog finalization and timeout handling.
- Expanded runtime path detection for global installs (`%APPDATA%/npm` and `%USERPROFILE%/.local`) and persisted detected runtime wrapper path after install.
- Hardened OpenClaw health checks to probe multiple commands (`--version`, `version`, `--help`) instead of relying on a single flag.
- Fixed launch routing to prioritize the installed runtime wrapper (`runtimeInstalledPath` / healthy `openclaw.cmd`) before bundled OpenClaw entry, preventing dashboard startup from using stale packaged runtime.
- Added explicit child-process `error` and detailed `exit` logging for OpenClaw and controller processes to prevent runtime popup crashes and improve diagnosis.
- Fixed `%APPDATA%` runtime wrapper path resolution regression in startup checks (`Roaming` path was incorrectly resolved), which could cause fallback to bundled OpenClaw and gateway startup failure.
- Tightened runtime status health: persisted wrapper path now counts as installed only when the wrapper executes successfully.
- Fixed runtime status gating regression where successful installs could still show `Installed: no`; persisted runtime wrapper path now marks runtime installed when the file exists.
- Launch now always prefers the persisted installed runtime wrapper path when present, preventing accidental fallback to bundled runtime and disabled Start button.
- Fixed Windows shell spawn reliability: all command-shell calls now use resolved absolute `ComSpec`/`System32\\cmd.exe` path instead of plain `cmd.exe`, eliminating `spawn cmd.exe ENOENT` startup failures.
- Fixed OpenClaw launch `cwd` selection for CLI mode: runtime now uses an existing working directory (installed root/wrapper dir/runtime data dir) instead of potentially missing bundled path, preventing false `spawn ... ENOENT` on startup.
- Added launch log diagnostics to include the exact `cwd` used for OpenClaw gateway/onboarding starts.
- Fixed stale runtime wrapper handling: configured wrapper is now used only when healthy; otherwise Aegis falls back to other healthy launchers and surfaces a clear runtime error if none exist.
- Fixed false install success criteria: runtime install no longer treats mere wrapper file presence as success; it now requires a healthy launcher/build before marking completion.
- Reworked runtime installation to use a managed npm global prefix under `%APPDATA%/Projekt Aegis/runtime/npm-global` instead of relying on `openclaw.ai/install.ps1` execution.
- Updated launcher resolution to prefer a healthy `openclaw.mjs` entry from detected runtime roots before wrapper-based CLI launch.
- Hardened runtime status to report installed only when a healthy launcher is actually available, preventing false-positive "Installed: yes" states.
- Runtime install now runs via bundled `npm-cli.js` (not shell `install.ps1`), removing Git/script execution from the Aegis installer path.
- Added stale legacy runtime cleanup (`%APPDATA%/Projekt Aegis/runtime/openclaw`) and stale wrapper cleanup (`.local\\bin\\openclaw.cmd`) before managed runtime install.
- Strengthened wrapper validation: `.cmd` launchers are accepted only if they point to an existing `dist/entry.js` in a valid OpenClaw build.
- Added startup build log line (`[system] Aegis desktop <version> started`) to make runtime log/version verification unambiguous.
- Added local beta upload API secret file location for telemetry integration (path only, no secret content): `.secrets/prophet-upload-api-beta.key`.

## 2026-02-09

- Phase 3 implementation started with minimal-layout UI polish (no full redesign) and larger primary Start control for improved visibility.
- Added OpenClaw startup state UX: status now stays `starting service` after Start click and switches to `online` only after controller-gateway connection is confirmed in logs.
- Added Help panel actions: open local guide PDF (`src/guides/Help.pdf`) and manual log upload trigger for beta support.
- Implemented on-demand log upload pipeline to `https://api.prophettechnology.org/v1/logs/upload` using `Authorization: Bearer <secret>` from local secret file.
- Implemented upload-time sanitization (without mutating primary local logs): redacts `payload.result` content/output and masks common PII patterns before transmission.
- Added workspace-oriented security policy behavior for Phase 3:
  - writes inside `%USERPROFILE%\\Aegis_Workspace` default to green/silent;
  - writes outside workspace escalate to yellow notify;
  - delete intent outside workspace escalates to red approval block.

## 2026-02-10

- Phase 3 (Beta): bundled `src/guides/Help.pdf` and wired the Help panel to open it from installed resources.
- Phase 3 (Beta): ensured the log upload bearer key is read from a file (not hardcoded) and can be bundled into the installer via `extraResources` when `.secrets/prophet-upload-api-beta.key` exists locally at build time (file remains gitignored).
- Pulled the latest OpenClaw into `openclaw_new/` (gitignored) for analysis of Lobster typed workflow pipelines.
- Hardened policy to treat macro workflow tools (`lobster`, `workflow_tool`) as high-risk pending a Lobster-aware parser/enforcer.
- Updated Phase 3 telemetry target endpoint to: `https://api.prophettechnology.org/v1/logs/upload`.
- Bumped Phase 3 baseline version to `v0.2.1` across workspace packages and desktop release metadata.
- Updated controller gateway client version marker to `0.2.1` for runtime/client trace consistency.
- Updated README release metadata and installer naming examples to `0.2.1`.
- Validation run completed for `v0.2.1`: workspace tests and builds passed for `aegis-core`, `aegis-controller`, and `aegis-desktop`.
