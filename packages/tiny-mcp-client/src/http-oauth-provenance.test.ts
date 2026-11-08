import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer } from "./internal.js";
import type { StoredOAuthTokens } from "mcp-oauth";

const resource = "https://resource.example/mcp";
const metadata = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

it.each([false, true])("correlates concurrent 401 handlers with exact request provenance when fetch mutates its headers: %s", async mutate => {
  const firstEntered = Promise.withResolvers<void>();
  const firstResponse = Promise.withResolvers<Response>();
  const presented: { header: string | null | undefined; tokens: StoredOAuthTokens | null | undefined }[] = [];
  let authorization = 0;
  const provider = {
    authorizeRequest(input: { headers: Headers }) {
      const tokens: StoredOAuthTokens = { accessToken: `access-${++authorization}`, refreshToken: `refresh-${authorization}`, tokenType: "Bearer", expiresAt: authorization * 1000 };
      input.headers.set("Authorization", `Bearer ${tokens.accessToken}`);
      return tokens;
    },
    handleUnauthorized(input: { requestHeaders?: Headers; presentedTokens?: StoredOAuthTokens | null }) {
      presented.push({ header: input.requestHeaders?.get("Authorization"), tokens: input.presentedTokens });
      return { action: "retry" as const };
    }
  };
  const counts = new Map<string, number>();
  const unauthorized = () => new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://resource.example/metadata"' } });
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const request = JSON.parse(String(init.body));
      const count = (counts.get(request.method) ?? 0) + 1; counts.set(request.method, count);
      if (request.method === "first" && count === 1) {
        if (mutate) (init.headers as Headers).set("Authorization", "Bearer adapter-mutated-secret");
        firstEntered.resolve(); return firstResponse.promise;
      }
      if (request.method === "second" && count === 1) return unauthorized();
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete" } });
    }
    return Response.json(String(input) === "https://resource.example/metadata"
      ? { resource, authorization_servers: ["https://auth.example"] }
      : { issuer: "https://auth.example", authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  });
  const transport = new HttpTransport({ url: resource, oauth: { provider }, fetch });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 30_000, transport.closed.then(event => event.reason));
  const first = layer.sendRequest("first", { _meta: metadata });
  try {
    await firstEntered.promise;
    expect(await layer.sendRequest("second", { _meta: metadata })).toEqual({ resultType: "complete" });
    firstResponse.resolve(unauthorized());
    expect(await first).toEqual({ resultType: "complete" });
    expect(presented.map(value => value.header)).toEqual(["Bearer access-2", "Bearer access-1"]);
    expect(presented.map(value => value.tokens?.refreshToken)).toEqual(["refresh-2", "refresh-1"]);
  } finally { firstResponse.resolve(unauthorized()); layer.dispose(); transport.dispose(); await transport.closed; await first.catch(() => undefined); }
});
