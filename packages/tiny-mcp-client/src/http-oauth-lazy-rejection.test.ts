import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";

it("rejects a host-authorized tool call once without metadata discovery or write replay", async () => {
  const rejectAccessToken = vi.fn(() => ({ action: "fail" as const, error: new Error("Presented token rejected") }));
  const methods: string[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== "https://resource.example/mcp" || init?.method !== "POST") {
      throw new Error("Metadata access denied");
    }
    const request = JSON.parse(String(init.body));
    methods.push(request.method);
    (init.headers as Headers).set("Authorization", "Bearer host-token");
    if (request.method === "tools/call") return new Response(null, {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://resource.example/metadata"' }
    });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {} });
  });
  const transport = new HttpTransport({ url: "https://resource.example/mcp", fetch,
    oauth: { provider: { handleUnauthorized: rejectAccessToken } } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
  const params = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } };
  try {
    await layer.sendRequest("initialize", params);
    await expect(layer.sendRequest("tools/call", { ...params, name: "write", arguments: {} })).rejects.toThrow("Presented token rejected");
    expect(rejectAccessToken).toHaveBeenCalledTimes(1);
    expect(methods).toEqual(["initialize", "tools/call"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { layer.dispose(); transport.dispose(); await transport.closed; }
});

it("discovers metadata only on provider demand and shares the lookup within the rejected request", async () => {
  let metadataFetches = 0;
  const transport = new HttpTransport({ url: "https://resource.example/mcp", oauth: { provider: {
    async handleUnauthorized(input) {
      const first = input.discover!();
      expect(input.discover!()).toBe(first);
      expect((await first).resource).toBe("https://resource.example/mcp");
      return { action: "fail", error: new Error("Recovery declined") };
    }
  } }, fetch: async (url, init) => {
    if (init?.method === "POST") return new Response(null, { status: 401, headers: {
      "WWW-Authenticate": 'Bearer resource_metadata="https://resource.example/metadata"'
    } });
    metadataFetches++;
    return Response.json(String(url) === "https://resource.example/metadata"
      ? { resource: "https://resource.example/mcp", authorization_servers: ["https://auth.example"] }
      : { issuer: "https://auth.example", authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
  try {
    await expect(layer.sendRequest("tools/call", { _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}
    } })).rejects.toThrow("Recovery declined");
    expect(metadataFetches).toBe(2);
  } finally { layer.dispose(); transport.dispose(); await transport.closed; }
});
