import { expect, it, vi } from "vitest";
import { HttpTransport, McpClient } from "./index.js";

it.each(["2025-06-18", "2025-11-25"])("negotiates legacy %s and retains it on every HTTP channel", async protocolVersion => {
  const requests: { method: string; rpc?: string; version: string | null }[] = [];
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const request = init?.method === "POST" ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method: init!.method!, rpc: request?.method, version: headers.get("MCP-Protocol-Version") });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (request.method === "server/discover") return new Response(null, { status: 404 });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" } }
      : { tools: [] };
    return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "Mcp-Session-Id": "legacy-session" } });
  });
  const transport = new HttpTransport({ url: "https://legacy.example/mcp", fetch });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  try {
    expect(await client.connect(transport)).toMatchObject({ protocolVersion });
    expect(await client.listTools()).toEqual({ tools: [] });
  } finally { await client.close(); transport.dispose(); await transport.closed; }
  expect(requests.filter(request => request.rpc !== "server/discover" && request.rpc !== "initialize"))
    .toEqual(expect.arrayContaining([
      { method: "POST", rpc: "notifications/initialized", version: protocolVersion },
      { method: "POST", rpc: "tools/list", version: protocolVersion },
      { method: "GET", rpc: undefined, version: protocolVersion },
      { method: "DELETE", rpc: undefined, version: protocolVersion }
    ]));
  expect(requests.find(request => request.method === "GET")?.version).toBe(protocolVersion);
});

it.each(["2025-06-18", "2025-11-25"] as const)("honors explicit legacy %s without modern discovery", async protocolVersion => {
  const methods: string[] = [];
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)); methods.push(request.method);
    if (request.method === "notifications/initialized") {
      expect(new Headers(init?.headers).get("MCP-Protocol-Version")).toBe(protocolVersion);
      return new Response(null, { status: 202 });
    }
    expect(request.method).toBe("initialize");
    expect(request.params.protocolVersion).toBe(protocolVersion);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      protocolVersion, capabilities: {}, serverInfo: { name: "legacy", version: "1" }
    } });
  });
  const transport = new HttpTransport({ url: "https://legacy.example/mcp", fetch });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion });
  try { expect(await client.connect(transport)).toMatchObject({ protocolVersion }); }
  finally { await client.close(); transport.dispose(); await transport.closed; }
  expect(methods).toEqual(["initialize", "notifications/initialized"]);
});

it.each(["application/json", "text/event-stream"])("captures a raw initialization revision from %s before GET startup", async contentType => {
  const get = Promise.withResolvers<Headers>();
  const result = { jsonrpc: "2.0", id: "init", result: {
    protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "raw", version: "1" }
  } };
  const transport = new HttpTransport({ url: "https://legacy.example/mcp", fetch: async (_url, init) => {
    if (init?.method === "GET") {
      get.resolve(new Headers(init.headers));
      return new Response(null, { status: 405 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(contentType === "application/json" ? JSON.stringify(result) : `data: ${JSON.stringify(result)}\n\n`, {
      headers: { "Content-Type": contentType, "Mcp-Session-Id": "raw-session" }
    });
  } });
  try {
    transport.writable.write(`${JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-03-26" } })}\n`);
    expect((await get.promise).get("MCP-Protocol-Version")).toBe("2025-11-25");
  } finally { transport.dispose(); await transport.closed; }
});

it("rejects a different supported revision under an explicit legacy pin", async () => {
  const methods: string[] = [];
  const transport = new HttpTransport({ url: "https://legacy.example/mcp", fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); methods.push(request.method);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "legacy", version: "1" }
    } });
  } });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-03-26" });
  try { await expect(client.connect(transport)).rejects.toThrow("protocol version"); }
  finally { await client.close(); transport.dispose(); await transport.closed; }
  expect(methods).toEqual(["initialize"]);
});

it.each(["2025-06-18", "2025-11-25"] as const)("retains legacy %s on standalone SSE endpoint posts", async protocolVersion => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder(), cancel = vi.fn();
  const methods: string[] = [];
  const transport = new HttpTransport({ url: "https://legacy.example/sse", mode: "sse", fetch: async (url, init) => {
    if (init?.method === "GET") return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
      }, cancel
    }), { headers: { "Content-Type": "text/event-stream" } });
    expect(String(url)).toBe("https://legacy.example/messages");
    const request = JSON.parse(String(init?.body)); methods.push(request.method);
    if (request.method === "initialize") expect(request.params.protocolVersion).toBe(protocolVersion);
    else expect(new Headers(init?.headers).get("MCP-Protocol-Version")).toBe(protocolVersion);
    if (request.method !== "notifications/initialized") stream.enqueue(encoder.encode(`data: ${JSON.stringify({
      jsonrpc: "2.0", id: request.id, result: request.method === "initialize"
        ? { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "sse", version: "1" } }
        : { tools: [] }
    })}\n\n`));
    return new Response(null, { status: 202 });
  } });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion });
  try {
    expect(await client.connect(transport)).toMatchObject({ protocolVersion });
    expect(await client.listTools()).toEqual({ tools: [] });
  } finally { await client.close(); transport.dispose(); await transport.closed; }
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  expect(cancel).toHaveBeenCalledOnce();
});

it("releases an open initialization POST stream before sending later legacy requests", async () => {
  const cancel = vi.fn(), methods: string[] = [];
  const transport = new HttpTransport({ url: "https://legacy.example/mcp", fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); methods.push(request.method);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "initialize") return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        jsonrpc: "2.0", id: request.id, result: {
          protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "streaming", version: "1" }
        }
      })}\n\n`)); }, cancel
    }), { headers: { "Content-Type": "text/event-stream" } });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
  } });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-11-25", requestTimeoutMs: 50 });
  try {
    await client.connect(transport);
    await expect(client.listTools()).resolves.toEqual({ tools: [] });
    expect(cancel).toHaveBeenCalledOnce();
  } finally { await client.close(); transport.dispose(); await transport.closed; }
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
});
