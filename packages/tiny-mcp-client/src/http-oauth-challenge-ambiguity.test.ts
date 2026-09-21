import { expect, it, vi } from "vitest";
import { HttpTransport, JsonRpcMessageLayer, parseBearerWwwAuthenticateHeader } from "./internal.js";

it.each(["resource_metadata", "scope", "error", "realm", "extension", "__proto__"])(
  "rejects repeated case-insensitive Bearer %s parameters without reflecting values", name => {
    const header = `Bearer ${name}="original-private-value", ${name.toUpperCase()}="replacement-private-value"`;
    expect(() => parseBearerWwwAuthenticateHeader(header)).toThrow(new Error("Bearer challenge must not repeat authentication parameters"));
  }
);

it("rejects even identical repeated Bearer parameters", () => {
  expect(() => parseBearerWwwAuthenticateHeader('Bearer scope="read", scope="read"')).toThrow(new Error("Bearer challenge must not repeat authentication parameters"));
});

it.each([401, 403, "retried 401"] as const)("releases an ambiguous %s response before further OAuth work", async mode => {
  const cancel = vi.fn(), authorize = vi.fn(() => ({ action: "retry" as const }));
  const ambiguous = new Response(new ReadableStream({ cancel }), { status: mode === 403 ? 403 : 401, headers: {
    "WWW-Authenticate": 'Bearer resource_metadata="https://original.invalid/metadata", RESOURCE_METADATA="https://replacement.invalid/private-value"'
  } });
  let posts = 0, metadata = 0;
  const transport = new HttpTransport({ url: "https://resource.invalid/mcp", oauth: { provider: { handleUnauthorized: authorize } }, fetch: async (url, init) => {
    if (init?.method === "POST") {
      if (++posts === 1 && mode === "retried 401") return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://resource.invalid/metadata"' } });
      return ambiguous;
    }
    metadata++;
    if (String(url) === "https://resource.invalid/metadata") return Response.json({ resource: "https://resource.invalid/mcp", authorization_servers: ["https://auth.invalid"] });
    return Response.json({ issuer: "https://auth.invalid", authorization_endpoint: "https://auth.invalid/authorize", token_endpoint: "https://auth.invalid/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  } });
  const layer = new JsonRpcMessageLayer(transport.readable, transport.writable, 1_000, transport.closed.then(event => event.reason));
  try {
    await expect(layer.sendRequest("own", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } })).rejects.toThrow(new Error("Bearer challenge must not repeat authentication parameters"));
    expect(cancel).toHaveBeenCalledOnce();
    expect(posts).toBe(mode === "retried 401" ? 2 : 1);
    expect(metadata).toBe(mode === "retried 401" ? 2 : 0);
    expect(authorize).toHaveBeenCalledTimes(mode === "retried 401" ? 1 : 0);
  } finally { void ambiguous.body?.cancel().catch(() => undefined); layer.dispose(); transport.dispose(); await transport.closed; }
});

it("retains distinct parameters and independent non-Bearer challenges", () => {
  const header = 'Basic realm="first", REALM="second", Bearer realm="one", extension="two", scope="read"';
  expect(parseBearerWwwAuthenticateHeader(header)).toEqual({ scheme: "Bearer", params: { realm: "one", extension: "two", scope: "read" }, raw: header });
});
