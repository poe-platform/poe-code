import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

const resource = "https://resource.invalid/mcp";
const metadata = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

it.each(["authorize", "unauthorized", "metadata"] as const)("cancels originating OAuth work during %s without stopping another request", async phase => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  let first = true;
  const provider = {
    async authorizeRequest(input: { signal?: AbortSignal }) {
      if (phase !== "authorize" || !first) return;
      first = false; signal = input.signal; entered.resolve(); await release.promise;
    },
    async handleUnauthorized(input: { signal?: AbortSignal }) {
      signal = input.signal; entered.resolve(); await release.promise;
      return { action: "retry" as const };
    }
  };
  let posts = 0;
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      const request = JSON.parse(String(init.body));
      if (request.method === "slow" && phase !== "authorize") return new Response(null, { status: 401, headers: {
        "WWW-Authenticate": 'Bearer resource_metadata="https://resource.invalid/metadata"'
      } });
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } });
    }
    if (phase === "metadata") { signal = init?.signal as AbortSignal; entered.resolve(); await release.promise; }
    return Response.json(String(url) === "https://resource.invalid/metadata"
      ? { resource, authorization_servers: ["https://auth.invalid"] }
      : { issuer: "https://auth.invalid", authorization_endpoint: "https://auth.invalid/authorize", token_endpoint: "https://auth.invalid/token",
          response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  });
  const transport = new HttpTransport({ url: resource, oauth: { provider }, fetch });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
  let id!: number | string;
  const reason = new Error("cancel originating call");
  const pending = layer.sendRequest("slow", { _meta: metadata }, { onRequestId: value => { id = value; } }).catch(error => error);
  try {
    await entered.promise;
    layer.sendNotification("notifications/cancelled", { requestId: id });
    layer.cancelRequest(id, reason);
    expect(await pending).toBe(reason);
    await setImmediate();
    expect(signal?.aborted).toBe(true);
    release.resolve();
    await setImmediate();
    expect(await layer.sendRequest("other", { _meta: metadata })).toEqual({ resultType: "complete" });
    expect(posts).toBe(phase === "authorize" ? 1 : 2);
  } finally {
    release.resolve(); layer.dispose(); transport.dispose(); await transport.closed; await pending;
  }
});
