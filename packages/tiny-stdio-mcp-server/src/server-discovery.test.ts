import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

const _meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

describe("server/discover", () => {
  it("requires the modern metadata envelope on discovery requests", async () => {
    const server = createServer({ name: "discovery", version: "1" });
    expect(await server.handleMessage("server/discover")).toMatchObject({ error: { code: -32602 } });
  });
  it.each([
    null,
    [],
    "invalid",
    {},
    {
      "io.modelcontextprotocol/protocolVersion": 2026,
      "io.modelcontextprotocol/clientCapabilities": {}
    },
    { "io.modelcontextprotocol/protocolVersion": "2025-11-25" },
    {
      "io.modelcontextprotocol/protocolVersion": "2025-11-25",
      "io.modelcontextprotocol/clientCapabilities": []
    },
    Object.create({
      "io.modelcontextprotocol/protocolVersion": "2025-11-25",
      "io.modelcontextprotocol/clientCapabilities": {}
    })
  ].map((metadata) => [metadata]))("rejects malformed explicit request metadata %j", async (metadata) => {
    const server = createServer({ name: "discovery", version: "1" });
    expect(await server.handleMessage("server/discover", { _meta: metadata })).toMatchObject({
      error: { code: -32602 }
    });
  });
  it("advertises actual supported versions, identity, capabilities, and caching before initialization", async () => {
    const server = createServer({ name: "discovery", version: "1.0.0" });
    const discovery = await server.handleMessage("server/discover", { _meta });
    expect(discovery).toEqual({
      result: {
        resultType: "complete",
        supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true }
        },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "discovery", version: "1.0.0" } },
        ttlMs: 0,
        cacheScope: "private"
      }
    });
    expect(await server.handleMessage("tools/list")).toMatchObject({
      error: { message: "Server not initialized" }
    });
  });

  it("keeps the modern revision out of legacy initialization negotiation", async () => {
    const server = createServer({ name: "discovery", version: "1" });
    expect(await server.handleMessage("initialize", { protocolVersion: "2026-07-28" }))
      .toMatchObject({ result: { protocolVersion: "2025-11-25" } });
    expect(await server.handleMessage("initialize", { _meta }))
      .toMatchObject({ error: { code: -32601 } });
  });

  it("derives the same capability configuration as legacy initialization", async () => {
    const server = createServer({
      name: "discovery",
      version: "1",
      supportNotifications: false,
      supportResourceSubscriptions: false
    });
    const discovery = await server.handleMessage("server/discover", { _meta });
    const initialization = await server.handleMessage("initialize");
    expect(discovery.result).toMatchObject({
      capabilities: (initialization.result as { capabilities: unknown }).capabilities
    });
  });

  it("returns supported versions for an unsupported declared version", async () => {
    const server = createServer({ name: "discovery", version: "1" });
    expect(
      await server.handleMessage("server/discover", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "1900-01-01",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      })
    ).toEqual({
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { requested: "1900-01-01", supported: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"] }
      }
    });
  });

  it("supports discovery over stdio without a preceding handshake", async () => {
    const server = createServer({ name: "wire", version: "1" });
    const readable = new PassThrough();
    const writable = new PassThrough();
    let output = "";
    writable.on("data", (data) => {
      output += data.toString();
    });
    const closed = server.connect({ readable, writable });
    readable.end(
      JSON.stringify({ jsonrpc: "2.0", id: "discover", method: "server/discover", params: { _meta } }) + "\n"
    );
    await closed;
    expect(JSON.parse(output)).toMatchObject({
      id: "discover",
      result: {
        resultType: "complete",
        supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]
      }
    });
  });
});
