import path from "node:path";
import os from "node:os";

export type ControllerConfig = {
  controllerPort: number;
  gatewayWsUrl: string;
  gatewayHttpUrl: string;
  gatewayToken: string;
  execAgentId: string;
  identityPath: string;
};

export const loadConfig = (): ControllerConfig => {
  const controllerPort = Number(process.env.AEGIS_CONTROLLER_PORT ?? 18799);
  const gatewayWsUrl = process.env.AEGIS_GATEWAY_WS ?? "ws://127.0.0.1:18789";
  const gatewayHttpUrl = process.env.AEGIS_GATEWAY_HTTP ?? "http://127.0.0.1:18789";
  const gatewayToken = process.env.AEGIS_GATEWAY_TOKEN ?? "";
  const execAgentId = process.env.AEGIS_EXEC_AGENT_ID ?? "aegis-exec";
  const identityPath =
    process.env.AEGIS_IDENTITY_PATH ?? path.join(os.homedir(), ".projekt-aegis", "identity.json");

  if (!gatewayToken) {
    throw new Error("AEGIS_GATEWAY_TOKEN is required.");
  }

  return {
    controllerPort,
    gatewayWsUrl,
    gatewayHttpUrl,
    gatewayToken,
    execAgentId,
    identityPath,
  };
};
