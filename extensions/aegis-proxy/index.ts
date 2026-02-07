const defaultTimeoutMs = 120000;

function jsonResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

export default function register(api) {
  api.registerTool((ctx) => ({
    name: "aegis_proxy",
    description: "Route any tool call through Projekt Aegis policy engine.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tool: { type: "string", description: "Target tool name (e.g. read, exec, message)." },
        args: { type: "object", description: "Arguments for the target tool." },
        reason: { type: "string", description: "Why the tool is needed." },
      },
      required: ["tool"],
    },
    async execute(_id, params) {
      const cfg = api.pluginConfig ?? {};
      const controllerUrl = cfg.controllerUrl;
      if (!controllerUrl || typeof controllerUrl !== "string") {
        throw new Error("Aegis controllerUrl is not configured.");
      }
      const timeoutMs =
        typeof cfg.timeoutMs === "number" && Number.isFinite(cfg.timeoutMs)
          ? cfg.timeoutMs
          : defaultTimeoutMs;

      const payload = {
        agentId: ctx?.agentId ?? "unknown",
        sessionKey: ctx?.sessionKey ?? "agent:main:main",
        toolName: String(params.tool ?? ""),
        toolArgs: params.args && typeof params.args === "object" ? params.args : {},
        context: { agentReason: params.reason },
      };

      let controllerRes;
      try {
        controllerRes = await fetch(`${controllerUrl}/proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Aegis controller unreachable at ${controllerUrl}/proxy. ` +
            `Ensure Projekt Aegis is running. (${message})`,
        );
      }

      const body = await controllerRes.json();
      if (!controllerRes.ok) {
        throw new Error(body?.error ?? "Aegis proxy error");
      }

      return jsonResult(body?.result ?? body);
    },
  }));
}
