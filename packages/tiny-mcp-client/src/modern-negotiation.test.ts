import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpClient, type ClientCapabilities } from "./internal.js";

function setup() {
  const { clientTransport, serverTransport } = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "test", version: "1" } });
  onTestFinished(() => {
    server.dispose();
    clientTransport.dispose();
  });
  return { client, server, clientTransport, serverTransport };
}

describe("modern client negotiation", () => {
  it("uses the configured request deadline for explicit modern discovery", async () => {
    vi.useFakeTimers();
    const { server, clientTransport } = setup();
    onTestFinished(() => vi.useRealTimers());
    const client = new McpClient({ clientInfo: { name: "test", version: "1" },
      protocolVersion: "2026-07-28", requestTimeoutMs: 5000 });
    const initialize = vi.fn(() => ({ protocolVersion: "2025-03-26",
      capabilities: {}, serverInfo: { name: "legacy", version: "1" } }));
    server.onRequest("initialize", initialize);
    server.onRequest("server/discover", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { resultType: "complete", supportedVersions: ["2026-07-28"],
        capabilities: {}, ttlMs: 0, cacheScope: "private" };
    });
    const connected = client.connect(clientTransport);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await connected).toMatchObject({ protocolVersion: "2026-07-28" });
    expect(initialize).not.toHaveBeenCalled();
  });

  it("rejects malformed extension capabilities before writing discovery", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    const server = new JsonRpcMessageLayer(serverTransport.readable, serverTransport.writable);
    const discover = vi.fn(() => ({ resultType: "complete", supportedVersions: ["2026-07-28"],
      capabilities: {}, ttlMs: 0, cacheScope: "private" }));
    server.onRequest("server/discover", discover);
    const client = new McpClient({ clientInfo: { name: "test", version: "1" },
      capabilities: { extensions: { unprefixed: {} } } as ClientCapabilities });
    onTestFinished(() => { server.dispose(); clientTransport.dispose(); });
    await expect(client.connect(clientTransport)).rejects.toThrow("client capabilities");
    expect(discover).not.toHaveBeenCalled();
    expect(client.state).toBe("disconnected");
  });

  it.each(["modern", "legacy"])("owns identity snapshots after %s negotiation", async (mode) => {
    const { client, server, clientTransport } = setup();
    const identity = { name: "weather", version: "2", icons: [{ src: "https://example.test/icon.png" }] };
    server.onRequest("server/discover", () => {
      if (mode === "legacy") throw Object.assign(new Error("Unknown method"), { code: -32601 });
      return {
        resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: {},
        ttlMs: 0, cacheScope: "private", _meta: { "io.modelcontextprotocol/serverInfo": identity }
      };
    });
    server.onRequest("initialize", () => ({
      protocolVersion: "2025-03-26", capabilities: {}, serverInfo: identity
    }));
    const result = await client.connect(clientTransport);
    const exposed = client.serverInfo!;
    exposed.name = "mutated";
    exposed.icons![0]!.src = "https://example.test/mutated.png";
    expect(client.serverInfo).toEqual(identity);
    result.serverInfo!.icons![0]!.src = "https://example.test/result.png";
    expect(client.serverInfo).toEqual(identity);
  });

  it("discovers before initialization and attaches metadata to subsequent requests", async () => {
    const { client, server, clientTransport } = setup();
    const initialize = vi.fn(() => ({
      protocolVersion: "2025-03-26",
      capabilities: {},
      serverInfo: { name: "legacy", version: "1" }
    }));
    server.onRequest("initialize", initialize);
    server.onRequest("server/discover", (params) => {
      expect(params).toMatchObject({
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      });
      return {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: "private"
      };
    });
    server.onRequest("tools/list", (params) => {
      expect(params).toMatchObject({
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
      });
      return { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "private" };
    });
    expect(await client.connect(clientTransport)).toMatchObject({ protocolVersion: "2026-07-28" });
    expect(initialize).not.toHaveBeenCalled();
    expect(client.serverInfo).toBeNull();
    expect(await client.listTools()).toMatchObject({ tools: [] });
  });

  it("retains discovery identity and instructions", async () => {
    const { client, server, clientTransport } = setup();
    server.onRequest("server/discover", () => ({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {},
      instructions: "Use the weather tools",
      ttlMs: 0,
      cacheScope: "private",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "weather", version: "2" } }
    }));
    expect(await client.connect(clientTransport)).toMatchObject({
      serverInfo: { name: "weather", version: "2" },
      instructions: "Use the weather tools"
    });
    expect(client.instructions).toBe("Use the weather tools");
  });

  it.each([-32020, -32021, -32022])(
    "never falls back on recognized modern error %s",
    async (code) => {
      const { client, server, clientTransport, serverTransport } = setup();
      const initialize = vi.fn(() => ({
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: "legacy", version: "1" }
      }));
      server.onRequest("initialize", initialize);
      serverTransport.readable.on("data", (chunk) => {
        const message = JSON.parse(chunk.toString());
        if (message.method === "server/discover")
          serverTransport.writable.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { code, message: "modern error" }
            }) + "\n"
          );
      });
      await expect(client.connect(clientTransport)).rejects.toMatchObject({ code });
      expect(initialize).not.toHaveBeenCalled();
    }
  );
});

describe("HTTP discovery fallback", () => {
  it.each(["", "legacy session required"])(
    "preserves transport after an unrecognized 400 discovery response %j",
    async (body) => {
      const { HttpTransport } = await import("./internal.js");
      const methods: string[] = [];
      const transport = new HttpTransport({
        url: "https://example.test/mcp",
        fetch: async (_url, init) => {
          const message = JSON.parse(String(init?.body));
          methods.push(message.method);
          if (message.method === "server/discover") return new Response(body, { status: 400 });
          if (message.method === "notifications/initialized")
            return new Response(null, { status: 202 });
          return Response.json({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              serverInfo: { name: "legacy", version: "1" }
            }
          });
        }
      });
      onTestFinished(() => transport.dispose());
      const client = new McpClient({
        clientInfo: { name: "test", version: "1" },
        requestTimeoutMs: 50
      });
      expect(await client.connect(transport)).toMatchObject({ protocolVersion: "2025-03-26" });
      expect(methods.slice(0, 2)).toEqual(["server/discover", "initialize"]);
    }
  );
  it.each(
    [-32020, -32021, -32022].flatMap((code) => [undefined, null].map((id) => ({ code, id })))
  )("preserves recognized HTTP errors without an originating ID %j", async ({ code, id }) => {
    const { HttpTransport } = await import("./internal.js");
    const methods: string[] = [];
    const transport = new HttpTransport({
      url: "https://example.test/mcp",
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        if (request.method === "server/discover")
          return Response.json(
            {
              jsonrpc: "2.0",
              error: { code, message: "modern error" },
              ...(id === undefined ? {} : { id })
            },
            { status: 400 }
          );
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "legacy", version: "1" }
          }
        });
      }
    });
    onTestFinished(() => transport.dispose());
    const client = new McpClient({
      clientInfo: { name: "test", version: "1" },
      requestTimeoutMs: 50
    });
    await expect(client.connect(transport)).rejects.toMatchObject({ code });
    expect(methods).toEqual(["server/discover"]);
  });
});
