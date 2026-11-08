import { expect, it } from "vitest";
import { HttpTransport, McpClient } from "./internal.js";

it.each([503, "rejection"] as const)("preserves immediate discovery failure %s", async outcome => {
  const methods: string[] = [];
  const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async (_url, init) => {
    methods.push(JSON.parse(String(init?.body)).method);
    if (outcome === "rejection") throw new Error("synthetic reset");
    return new Response("unavailable", { status: outcome });
  } });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  try {
    await expect(client.connect(transport)).rejects.toThrow(outcome === "rejection" ? "synthetic reset" : "503");
    expect(methods).toEqual(["server/discover"]);
  } finally { await client.close(); }
});

it("preserves immediate 404 discovery fallback", async () => {
  const methods: string[] = [];
  const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async (_url, init) => {
    const message = JSON.parse(String(init?.body));
    methods.push(message.method);
    if (message.method === "server/discover") return new Response(null, { status: 404 });
    if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2025-03-26", serverInfo: { name: "fixture", version: "1" }, capabilities: {}
    } });
    return new Response(null, { status: 202 });
  } });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  try {
    await client.connect(transport);
    expect(methods).toEqual(["server/discover", "initialize", "notifications/initialized"]);
  } finally { await client.close(); }
});

it("cancels discovery without starting legacy initialization when the caller aborts", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const pending = Promise.withResolvers<Response>();
  const methods: string[] = [];
  const transport = new HttpTransport({ url: "https://example.test/mcp", fetch: async (_url, init) => {
    methods.push(JSON.parse(String(init?.body)).method);
    started.resolve(init!.signal!);
    return pending.promise;
  } });
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  const connected = client.connect(transport, { signal: controller.signal }).catch(error => error);
  try {
    const signal = await started.promise;
    controller.abort(reason);
    expect(await connected).toBe(reason);
    expect(signal.aborted).toBe(true);
    expect(methods).toEqual(["server/discover"]);
  } finally {
    pending.reject(new Error("late ignored rejection"));
    await client.close();
  }
});
