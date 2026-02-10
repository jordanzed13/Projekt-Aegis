import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  buildDeviceAuthPayload,
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "./device-identity.js";

export type GatewayClientOptions = {
  url: string;
  token: string;
  identityPath: string;
  onEvent?: (evt: { event: string; payload?: unknown }) => void;
  onError?: (err: Error) => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connectNonce: string | null = null;
  private connected = false;
  private opts: GatewayClientOptions;
  private readonly clientId = "gateway-client";
  private readonly clientMode = "backend";
  private readonly clientVersion = "0.2.2";

  constructor(opts: GatewayClientOptions) {
    this.opts = opts;
  }

  connect(): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url, { maxPayload: 25 * 1024 * 1024 });
      this.ws = ws;

      ws.on("message", (data: WebSocket.RawData) => this.handleMessage(data.toString()));
      ws.on("open", () => {
        // wait for connect.challenge
      });
      ws.on("close", () => {
        this.connected = false;
      });
      ws.on("error", (err: Error) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.opts.onError?.(error);
        reject(error);
      });

      this.onConnected = resolve;
      this.onConnectError = reject;
    });
  }

  private onConnected?: () => void;
  private onConnectError?: (err: Error) => void;

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  private sendConnect() {
    const identity = loadOrCreateDeviceIdentity(this.opts.identityPath);
    const signedAtMs = Date.now();
    const scopes = ["operator.read", "operator.write", "operator.approvals"];
    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: this.clientId,
      clientMode: this.clientMode,
      role: "operator",
      scopes,
      signedAtMs,
      token: this.opts.token,
      nonce: this.connectNonce,
    });
    const signature = signDevicePayload(identity.privateKeyPem, payload);

    const id = randomUUID();
    const frame = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: this.clientId,
          version: this.clientVersion,
          platform: process.platform,
          mode: this.clientMode,
        },
        role: "operator",
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: this.opts.token },
        device: {
          id: identity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
          signature,
          signedAt: signedAtMs,
          nonce: this.connectNonce,
        },
      },
    };

    this.pending.set(id, {
      resolve: () => {
        this.connected = true;
        this.onConnected?.();
        this.onConnected = undefined;
      },
      reject: (err) => {
        this.onConnectError?.(err);
        this.onConnectError = undefined;
      },
    });

    this.ws?.send(JSON.stringify(frame));
  }

  private handleMessage(raw: string) {
    try {
      const parsed = JSON.parse(raw) as { type?: string; event?: string; id?: string; ok?: boolean };
      if (parsed.type === "event" && parsed.event === "connect.challenge") {
        const payload = parsed as { payload?: { nonce?: string } };
        this.connectNonce = payload.payload?.nonce ?? null;
        this.sendConnect();
        return;
      }

      if (parsed.type === "res" && parsed.id && this.pending.has(parsed.id)) {
        const pending = this.pending.get(parsed.id);
        if (!pending) {
          return;
        }
        this.pending.delete(parsed.id);
        if (parsed.ok) {
          pending.resolve((parsed as { payload?: unknown }).payload);
        } else {
          const message = (parsed as { error?: { message?: string } }).error?.message ?? "gateway error";
          pending.reject(new Error(message));
        }
        return;
      }

      if (parsed.type === "event") {
        this.opts.onEvent?.({ event: parsed.event ?? "unknown", payload: (parsed as { payload?: unknown }).payload });
      }
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = randomUUID();
    const frame = { type: "req", id, method, params };
    this.ws.send(JSON.stringify(frame));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });
  }
}
