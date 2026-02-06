import { loadConfig } from "./config.js";
import { GatewayClient } from "./gateway-client.js";
import { createServer } from "./server.js";
import { ApprovalManager } from "./approvals.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const config = loadConfig();
  let approvals: ApprovalManager;

  const gateway = new GatewayClient({
    url: config.gatewayWsUrl,
    token: config.gatewayToken,
    identityPath: config.identityPath,
    onEvent: (evt) => approvals?.handleEvent(evt),
    onError: (err) => console.error("Gateway client error", err),
  });
  approvals = new ApprovalManager(gateway);

  while (true) {
    try {
      await gateway.connect();
      break;
    } catch (err) {
      console.error("Waiting for OpenClaw gateway...", err);
      await sleep(2000);
    }
  }

  const server = createServer(config, gateway, approvals);
  server.listen(config.controllerPort, "127.0.0.1", () => {
    console.log(`Aegis Controller listening on 127.0.0.1:${config.controllerPort}`);
  });

  console.log("Aegis Controller connected to OpenClaw gateway");

  process.on("SIGINT", () => {
    server.close();
    gateway.disconnect();
    process.exit(0);
  });
};

main().catch((err) => {
  console.error("Aegis Controller failed to start", err);
  process.exit(1);
});
