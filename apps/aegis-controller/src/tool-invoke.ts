export type ToolInvokeRequest = {
  gatewayHttpUrl: string;
  token: string;
  tool: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  action?: string;
};

export async function invokeTool(params: ToolInvokeRequest): Promise<unknown> {
  const response = await fetch(`${params.gatewayHttpUrl}/tools/invoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: params.tool,
      action: params.action,
      args: params.args ?? {},
      sessionKey: params.sessionKey,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`tool invoke failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { ok?: boolean; result?: unknown; error?: unknown };
  if (payload?.ok === false) {
    throw new Error(`tool invoke error: ${JSON.stringify(payload.error)}`);
  }
  return payload?.result ?? payload;
}
