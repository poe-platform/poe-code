import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

it("preserves OAuth candidate deadlines through the HTTP transport", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const entered = Promise.withResolvers<void>();
  let metadataSignal: AbortSignal | undefined;
  const transport = new HttpTransport({ url: "https://resource.invalid/mcp", oauth: { provider: {
    handleUnauthorized: () => ({ action: "fail" })
  } }, fetch: async (_url, init) => {
    if (init?.method === "POST") return new Response(null, { status: 401, headers: {
      "WWW-Authenticate": 'Bearer resource_metadata="https://resource.invalid/metadata"'
    } });
    metadataSignal = init?.signal as AbortSignal;
    entered.resolve();
    metadataSignal.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => {
      metadataSignal!.addEventListener("abort", () => reject(metadataSignal!.reason), { once: true });
    });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000,
    transport.closed.then(event => event.reason));
  const observed = layer.sendRequest("own", { _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}
  } }).catch((error: unknown) => error);
  try {
    await entered.promise;
    deadline.abort(new Error("metadata deadline"));
    expect(metadataSignal!.aborted).toBe(true);
    await expect(observed).resolves.toBeInstanceOf(Error);
  } finally {
    layer.dispose(); transport.dispose(); await observed; timeout.mockRestore();
  }
});

it.each(["retry", "provider error", "provider throws", "challenge error", "discovery error"] as const)(
  "releases original and cloned unauthorized bodies after %s",
  async (action) => {
    const cancel = vi.fn();
    const original = new Response(new ReadableStream({ cancel }), { status: 401, headers: {
      "WWW-Authenticate": 'Bearer error="invalid_token", resource_metadata="https://resource.invalid/metadata"'
    } });
    let clone: Response | undefined;
    let posts = 0;
    const transport = new HttpTransport({ url: "https://resource.invalid/mcp", oauth: { provider: {
      handleUnauthorized(input) {
        clone = input.response;
        if (action === "provider throws") throw new Error("provider threw");
        if (action === "provider error") return { action: "fail", error: new Error("provider failed") };
        return { action: action === "retry" ? "retry" : "fail" };
      }
    } }, fetch: async (url, init) => {
      if (init?.method === "POST") {
        if (++posts === 1) return original;
        const request = JSON.parse(String(init.body));
        return Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", success: true } });
      }
      if (action === "discovery error") throw new Error("discovery failed");
      if (String(url) === "https://resource.invalid/metadata") return Response.json({ resource: "https://resource.invalid/mcp", authorization_servers: ["https://auth.invalid"] });
      return Response.json({ issuer: "https://auth.invalid", authorization_endpoint: "https://auth.invalid/authorize", token_endpoint: "https://auth.invalid/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
    } });
    const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
    try {
      const operation = layer.sendRequest("own", { _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}
      } });
      if (action === "retry") await expect(operation).resolves.toMatchObject({ success: true });
      else await expect(operation).rejects.toBeInstanceOf(Error);
      expect(cancel).toHaveBeenCalledOnce();
      expect(original.bodyUsed).toBe(true);
      if (clone !== undefined) expect(clone.bodyUsed).toBe(true);
    } finally {
      await Promise.allSettled([original.body?.cancel(), clone?.body?.cancel()]);
      layer.dispose(); transport.dispose(); await transport.closed;
    }
  }
);
