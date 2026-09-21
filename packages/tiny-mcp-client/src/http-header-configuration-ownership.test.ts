import { expect, it, vi } from "vitest";
import { HttpTransport, McpClient, type HttpTransportFetch } from "./index.js";

const resource = "https://resource.example/mcp";

function remote() {
  const requests: string[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get("X-Tenant")).toBe("original-tenant");
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body)); requests.push(request.method);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "original", version: "1" } }
      : { content: [{ type: "text", text: "complete" }], structuredContent: request.params.arguments, _meta: { exact: "005930" } };
    return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "Mcp-Session-Id": "original-session" } });
  });
  return { fetch, requests };
}

it.each(["record", "tuples", "Headers"] as const)("owns configured %s headers before native OAuth clocks run", async representation => {
  const headers: HeadersInit = representation === "record" ? { "X-Tenant": "original-tenant" }
    : representation === "tuples" ? [["X-Tenant", "original-tenant"]] : new Headers({ "X-Tenant": "original-tenant" });
  const f = remote(), now = vi.fn(() => {
    if (headers instanceof Headers) headers.set("X-Tenant", "replacement-tenant");
    else if (Array.isArray(headers)) headers[0][1] = "replacement-tenant";
    else headers["X-Tenant"] = "replacement-tenant";
    return 1000;
  });
  const transport = new HttpTransport({ url: resource, headers, fetch: f.fetch, oauth: {
    client: { mode: "static", clientId: "original-app" }, browser: {}, now,
    initialGrant: { resource, tokens: { accessToken: "original-access", tokenType: "Bearer", expiresIn: 3600 } },
    sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} }
  } });
  const client = new McpClient({ clientInfo: { name: "headers-test", version: "1" }, protocolVersion: "2025-03-26" });
  try {
    await client.connect(transport);
    expect(await client.callTool({ name: "find", arguments: { query: "005930" } })).toEqual({
      content: [{ type: "text", text: "complete" }], structuredContent: { query: "005930" }, _meta: { exact: "005930" }
    });
    expect(now).toHaveBeenCalled();
    expect(f.requests).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  } finally { await client.close(); transport.dispose(); await transport.closed; }
  expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it.each(["private-header-value\nsecond", "private-header-value\0second"])("rejects unusable static header values with safe diagnostics: %#", async value => {
  const fetch = vi.fn<HttpTransportFetch>(), client = new McpClient({ clientInfo: { name: "headers-test", version: "1" }, protocolVersion: "2025-03-26" });
  let transport: HttpTransport | undefined;
  let failure: unknown;
  try {
    transport = new HttpTransport({ url: resource, headers: { "X-API-Key": value }, fetch });
    await client.connect(transport);
  } catch (error) { failure = error; }
  finally { await client.close(); transport?.dispose(); if (transport !== undefined) await transport.closed; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ message: "Invalid HTTP transport headers" });
  expect(String(failure)).not.toContain("private-header-value");
  expect(fetch).not.toHaveBeenCalled();
});
