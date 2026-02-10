# OpenClaw Lobster Impact (Phase 3 Notes)

This note captures what changed in OpenClaw with "Lobster" and why it matters for Projekt Aegis sandboxing.

Local analysis snapshot:

- `openclaw_new/` HEAD: `2914cb1d487dfb4780b04c7223d15913aad2f42e` (pulled 2026-02-10)

## What Lobster Is

OpenClaw exposes Lobster as an optional plugin tool named `lobster`.

- The `lobster` tool runs a local `lobster` CLI subprocess in "tool mode" and expects a typed JSON envelope on stdout.
- A single tool call can execute a multi-step pipeline (including shell commands) and can pause/resume via an approval token.

From Aegis' perspective, this is a "macro tool": one tool call can fan out to many side effects.

## Why This Matters For Aegis

Aegis enforces guardrails by intercepting tool calls and applying policy before allowing execution.

If the agent is allowed to call `lobster`, then:

- The underlying pipeline steps run inside the OpenClaw host process (or a subprocess) and are not guaranteed to be visible as individual tool calls to Aegis.
- This can bypass per-tool policy (for example, shell execution and filesystem access) unless we explicitly treat Lobster as high risk or implement a Lobster-aware policy layer.

## Current Stance (Beta)

- `lobster` and `workflow_tool` are treated as high-risk macro tools.
- Default policy outcome is `RED` and blocked pending explicit user approval.

This keeps the sandbox model coherent until we implement deeper integration.

## Adaptation Options

1. Enable Lobster with Gateway-level monitoring (target approach for `v0.2.2+`):
   - Intercept at Gateway `before_tool_call` for `lobster`.
   - Log the workflow inputs (sanitized) for audit and incident response.
   - Enforce a strict allowlist over Lobster operators/subcommands, and hard-block forbidden patterns.
2. Keep Lobster enabled but require approval for every `lobster` tool call (safe fallback).
3. Move to a strict whitelist (more complete):
   - Intercept at Gateway `before_tool_call` for `lobster`.
   - Validate workflow JSON against a schema to reject malformed workflows early.
   - Allow only approved Lobster operators/subcommands and forbid direct shell execution patterns unless explicitly whitelisted.
   - Hard-deny agent attempts to modify Lobster workflow documents (no approval path).
4. Implement a Lobster-aware preflight parser:
   - Parse `pipeline` / workflow file inputs.
   - Reject or require approval when the pipeline contains sensitive commands, writes outside workspace, network exfil patterns, or high-risk env changes.
5. Require "tool-only" pipelines:
   - Enforce that workflows use `openclaw.invoke` to call OpenClaw tools (which Aegis can intercept), and forbid direct shell execution in Lobster.
6. Run Lobster in a stricter sandbox:
   - Restrict working directory and environment.
   - Enforce allowlists at the OS level (AppContainer, low integrity, etc.) so Lobster cannot exceed Aegis' intent.

## Recommendation

For `v0.2.2`, enable Lobster with Gateway-level monitoring and sanitized workflow logging, then incrementally tighten enforcement with an allowlist + schema validation and sequence-aware exfiltration detection.
