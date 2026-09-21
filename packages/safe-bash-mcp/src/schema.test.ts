import { describe, expect, it, vi } from "vitest";
import type { HttpTransportFetch, Tool } from "tiny-mcp-client";
import { fetchRemoteMcpSchema, resolveRemoteMcpSchemas } from "./index.js";

const tool: Tool = {
  name: "search_items",
  description: "Find items",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputSchema: { type: "object", properties: { count: { type: "integer" } } },
  annotations: { readOnlyHint: true }
};
const server = { name: "catalog", url: "https://catalog.example/mcp" };

function remote(pages: unknown[]) {
  let page = 0;
  const methods: string[] = [];
  const cursors: unknown[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    methods.push(request.method);
    if (request.method === "server/discover") return new Response(JSON.stringify({
      jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" }
    }), { headers: { "Content-Type": "application/json" } });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize" ? {
      protocolVersion: "2025-03-26", capabilities: { tools: {} },
      serverInfo: { name: "catalog-server", version: "2" }, instructions: "Read before writing"
    } : (cursors.push(request.params?.cursor), pages[page++]);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "catalog-session" }
    });
  });
  return { fetch, methods, cursors };
}

describe("remote MCP schemas", () => {
  it("captures later registry OAuth provider selection before the first discovery waits", async () => {
    const fixture = remote([{ tools: [tool] }, { tools: [tool] }]), fetch = fixture.fetch.getMockImplementation()!;
    const initialized = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    fixture.fetch.mockImplementation(async (url, init) => {
      if (String(url) === server.url && init?.method === "POST" && JSON.parse(String(init.body)).method === "initialize") {
        initialized.resolve(); await resume.promise;
      }
      return fetch(url, init);
    });
    const original = vi.fn(async ({ headers }: { headers: Headers }) => { headers.set("Authorization", "Bearer original-selection"); });
    const replacement = vi.fn(async ({ headers }: { headers: Headers }) => { headers.set("Authorization", "Bearer replacement-selection"); });
    const oauth = { provider: { authorizeRequest: original, handleUnauthorized: async () => ({ action: "fail" as const }) } };
    const later = { name: "later", url: "https://later.example/mcp", protocolVersion: "2025-03-26" as const, oauth };
    const pending = resolveRemoteMcpSchemas([{ ...server, protocolVersion: "2025-03-26" }, later], { fetch: fixture.fetch });
    const outcome = pending.catch(error => error);
    try {
      await initialized.promise;
      oauth.provider = { ...oauth.provider, authorizeRequest: replacement };
      resume.resolve();
      expect(await outcome).toHaveLength(2);
      expect(original).toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      const posts = fixture.fetch.mock.calls.filter(([url, init]) => String(url) === later.url && init?.method === "POST");
      for (const [, init] of posts) expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer original-selection");
    } finally { resume.resolve(); await outcome; }
  });

  it.each(["identity", "headers", "signal handle"])("snapshots %s before asynchronous schema discovery", async mode => {
    const fixture = remote([{ tools: [tool] }]), fetch = fixture.fetch.getMockImplementation()!;
    const initialized = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const headers = new Headers({ "X-Tenant": "original" });
    const owned = { ...server, headers, protocolVersion: "2025-03-26" as const };
    const settings = { fetch: fixture.fetch, signal: new AbortController().signal };
    fixture.fetch.mockImplementation(async (url, init) => {
      if (init?.method === "POST" && JSON.parse(String(init.body)).method === "initialize") {
        initialized.resolve(); await resume.promise;
      }
      return fetch(url, init);
    });
    const pending = fetchRemoteMcpSchema(owned, settings);
    const outcome = pending.catch(error => error);
    try {
      await initialized.promise;
      if (mode === "identity") { owned.name = "replacement"; owned.url = "https://replacement.example/mcp"; }
      else if (mode === "headers") headers.set("X-Tenant", "replacement");
      else settings.signal = AbortSignal.abort(new Error("Replacement signal"));
      resume.resolve();
      const result = await outcome;
      expect(result).toMatchObject({ name: server.name, url: server.url, tools: [tool] });
      const calls = fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST" && JSON.parse(String(init.body)).method === "tools/list");
      expect(calls).toHaveLength(1);
      expect(new Headers(calls[0][1]?.headers).get("X-Tenant")).toBe("original");
    } finally { resume.resolve(); await outcome; }
  });

  it("snapshots the complete registry and supplied schemas before the first discovery waits", async () => {
    const fixture = remote([{ tools: [tool] }]), fetch = fixture.fetch.getMockImplementation()!;
    const initialized = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    fixture.fetch.mockImplementation(async (url, init) => {
      if (init?.method === "POST" && JSON.parse(String(init.body)).method === "initialize") {
        initialized.resolve(); await resume.promise;
      }
      return fetch(url, init);
    });
    const supplied = { ...server, name: "supplied", tools: [structuredClone(tool)], instructions: "Original guidance" };
    const registry = [{ ...server, protocolVersion: "2025-03-26" as const }, supplied];
    const pending = resolveRemoteMcpSchemas(registry, { fetch: fixture.fetch });
    const outcome = pending.catch(error => error);
    try {
      await initialized.promise;
      supplied.name = "replacement"; supplied.url = "https://replacement.example/mcp";
      supplied.tools[0].name = "replacement_tool"; supplied.instructions = "Replacement guidance";
      registry.push({ ...server, name: "appended", tools: [], instructions: "Appended" });
      resume.resolve();
      const result = await outcome;
      expect(result).toHaveLength(2);
      expect(result[1]).toMatchObject({ name: "supplied", url: server.url, tools: [tool], instructions: "Original guidance", source: "provided" });
      expect(fixture.methods.filter(method => method === "tools/list")).toHaveLength(1);
    } finally { resume.resolve(); await outcome; }
  });

  it.each(["2099-01-01", "auto", null, 42])("rejects unsupported protocol pins even with supplied schemas: %j", async protocolVersion => {
    const fetch = vi.fn<HttpTransportFetch>();
    const invalid = { ...server, tools: [], protocolVersion: protocolVersion as never };
    await expect(fetchRemoteMcpSchema(invalid, { fetch })).rejects.toThrow("protocolVersion");
    await expect(resolveRemoteMcpSchemas([server, { ...invalid, name: "later" }], { fetch })).rejects.toThrow("protocolVersion");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])("rejects overflowing request deadlines even for supplied schemas: %s", async requestTimeoutMs => {
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(fetchRemoteMcpSchema({ ...server, tools: [] }, { fetch, requestTimeoutMs })).rejects.toThrow("requestTimeoutMs");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns supplied instructions with authoritative schemas without connecting", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    expect(await fetchRemoteMcpSchema({ ...server, tools: [], instructions: "Read first\nThen act" }, { fetch })).toMatchObject({ instructions: "Read first\nThen act" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates supplied instructions across the registry before discovering anything", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(resolveRemoteMcpSchemas([server, { ...server, name: "bad", instructions: 42 } as never], { fetch })).rejects.toThrow("instructions");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses supplied schemas without touching the network and preserves metadata", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    const result = await fetchRemoteMcpSchema({ ...server, tools: [tool] }, { fetch });
    expect(result.tools).toEqual([tool]);
    expect(result.source).toBe("provided");
    expect(fetch).not.toHaveBeenCalled();
    result.tools[0].inputSchema.type = "changed";
    expect(tool.inputSchema.type).toBe("object");
  });

  it("treats an empty provided list as authoritative", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    expect((await fetchRemoteMcpSchema({ ...server, tools: [] }, { fetch })).tools).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("discovers every page, metadata and instructions using our MCP client", async () => {
    const fixture = remote([{ tools: [tool], nextCursor: "next" }, { tools: [{ ...tool, name: "count" }] }]);
    const result = await fetchRemoteMcpSchema(server, { fetch: fixture.fetch });
    expect(result).toMatchObject({
      name: "catalog", url: server.url, source: "discovered", tools: [tool, { ...tool, name: "count" }],
      serverInfo: { name: "catalog-server", version: "2" }, instructions: "Read before writing"
    });
    expect(fixture.cursors).toEqual([undefined, "next"]);
    expect(fixture.methods).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list", "tools/list"]);
    expect(fixture.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it.each(["Host guidance", ""])("keeps explicit instructions authoritative during discovery: %j", async instructions => {
    const fixture = remote([{ tools: [tool] }]);
    expect((await fetchRemoteMcpSchema({ ...server, instructions }, { fetch: fixture.fetch })).instructions).toBe(instructions);
  });

  it("discovers schemas through a legacy SSE endpoint handshake", async () => {
    let stream: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const fetch = vi.fn<HttpTransportFetch>(async (input, init) => {
      if (init?.method === "GET") return new Response(new ReadableStream({
        start(controller) {
          stream = controller;
          controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
        }, cancel
      }), { headers: { "Content-Type": "text/event-stream" } });
      expect(input.toString()).toBe("https://catalog.example/messages");
      const request = JSON.parse(String(init?.body));
      if (request.id !== undefined) {
        const response = request.method === "initialize" ? { result: {
          protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" }
        } } : request.method === "server/discover" ? { error: { code: -32601, message: "Method not found" } }
          : { result: { tools: [tool] } };
        stream.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response })}\n\n`));
      }
      return new Response(null, { status: 202 });
    });
    const result = await fetchRemoteMcpSchema({ ...server, transport: "sse" }, { fetch });
    expect(result.tools).toEqual([tool]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects unsupported transport modes before fetching", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    // A JSON configuration is not protected by TypeScript's union.
    await expect(fetchRemoteMcpSchema({ ...server, transport: "stdio" } as never, { fetch })).rejects.toThrow("transport");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cleans up after a pagination error", async () => {
    const fixture = remote([{ tools: [tool], nextCursor: "one" }, { tools: [tool] }]);
    await expect(fetchRemoteMcpSchema(server, { fetch: fixture.fetch })).rejects.toThrow("Duplicate tool");
    expect(fixture.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("preflights invalid supplied tool schemas in later registry entries", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(resolveRemoteMcpSchemas([server, { ...server, name: "broken", tools: [{ name: "bad", inputSchema: [] } as never] }], { fetch }))
      .rejects.toThrow("Invalid MCP tool schema");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate supplied tools without touching the network", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(fetchRemoteMcpSchema({ ...server, tools: [tool, tool] }, { fetch })).rejects.toThrow("Duplicate tool");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid supplied output schemas", async () => {
    await expect(fetchRemoteMcpSchema({ ...server, tools: [{ ...tool, outputSchema: [] } as never] })).rejects.toThrow("outputSchema");
  });

  it("detects cursor cycles instead of hanging", async () => {
    const fixture = remote([{ tools: [], nextCursor: "cycle" }, { tools: [], nextCursor: "cycle" }]);
    await expect(fetchRemoteMcpSchema(server, { fetch: fixture.fetch })).rejects.toThrow("cursor");
    expect(fixture.cursors).toHaveLength(2);
  });

  it("bounds page count even with unique cursors", async () => {
    const fixture = remote([{ tools: [], nextCursor: "one" }, { tools: [], nextCursor: "two" }]);
    await expect(fetchRemoteMcpSchema(server, { fetch: fixture.fetch, maxPages: 2 })).rejects.toThrow("page limit");
    expect(fixture.cursors).toHaveLength(2);
  });

  it("bounds tool count before accumulating more pages", async () => {
    const fixture = remote([{ tools: [tool], nextCursor: "one" }, { tools: [{ ...tool, name: "other" }] }]);
    await expect(fetchRemoteMcpSchema(server, { fetch: fixture.fetch, maxTools: 1 })).rejects.toThrow("tool limit");
  });

  it("rejects duplicate tools across pages", async () => {
    const fixture = remote([{ tools: [tool], nextCursor: "one" }, { tools: [tool] }]);
    await expect(fetchRemoteMcpSchema(server, { fetch: fixture.fetch })).rejects.toThrow("Duplicate tool");
  });

  it.each(["file:///bin/server", "ftp://example/mcp", "https://user:password@example/mcp", "https://example/mcp#fragment", "relative/mcp"])(
    "rejects non-remote or unsafe URL %s before fetching", async url => {
      const fetch = vi.fn<HttpTransportFetch>();
      await expect(fetchRemoteMcpSchema({ ...server, url, tools: [tool] }, { fetch })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("accepts loopback HTTP endpoints", async () => {
    expect((await fetchRemoteMcpSchema({ ...server, url: "http://127.0.0.1:4321/mcp", tools: [] })).url)
      .toBe("http://127.0.0.1:4321/mcp");
  });

  it.each([0, -1, Infinity, NaN, 1.5])("rejects invalid limits %s even with supplied schemas", async maxPages => {
    await expect(fetchRemoteMcpSchema({ ...server, tools: [] }, { maxPages })).rejects.toThrow("positive safe integer");
  });

  it("honors cancellation before provided-schema processing or connection", async () => {
    const signal = AbortSignal.abort(new Error("cancelled"));
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(fetchRemoteMcpSchema({ ...server, tools: [] }, { fetch, signal })).rejects.toThrow("cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preflights the complete registry before opening any connection", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(resolveRemoteMcpSchemas([server, { ...server, name: "bad", url: "file:///bad" }], { fetch }))
      .rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate registry names before opening any connection", async () => {
    const fetch = vi.fn<HttpTransportFetch>();
    await expect(resolveRemoteMcpSchemas([server, server], { fetch })).rejects.toThrow("Duplicate server");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves a mixed registry in caller order", async () => {
    const fixture = remote([{ tools: [tool] }]);
    const result = await resolveRemoteMcpSchemas([{ ...server, name: "static", tools: [] }, server], { fetch: fixture.fetch });
    expect(result.map(entry => [entry.name, entry.source])).toEqual([["static", "provided"], ["catalog", "discovered"]]);
  });
});
