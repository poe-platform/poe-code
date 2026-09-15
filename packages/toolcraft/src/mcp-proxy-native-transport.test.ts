import { expect, it, vi } from "vitest";
import { vol } from "memfs";
import { createServer } from "tiny-stdio-mcp-server";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpError } from "tiny-mcp-client";
import { defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { disposeMcpProxies } from "./mcp-proxy.js";

const transports = vi.hoisted(() => ({ queue: [] as unknown[] }));
vi.mock("tiny-mcp-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("tiny-mcp-client")>();
  return { ...actual, StdioTransport: vi.fn(function () { return transports.queue.shift(); }) };
});
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

it("preserves upstream intersections, open inputs, and scalar outputs through a real MCP client and proxy", async () => {
  vol.reset();
  vol.fromJSON({ "/repo/package.json": '{"name":"native-proxy-qa"}' });
  const inputSchema = { type: "object" as const, allOf: [
    { properties: { a: { type: "string" } }, required: ["a"] },
    { properties: { b: { type: "integer", multipleOf: 3 } }, required: ["b"] }
  ] };
  const outputSchema = { type: "integer" as const, minimum: 7, exclusiveMaximum: 10 };
  const handler = vi.fn((_args: unknown) => 7);
  const upstream = createServer({ name: "upstream", version: "1" }).registerTool({ name: "work", inputSchema, outputSchema }, handler);
  const pairs = Array.from({ length: 2 }, () => createInMemoryTransportPair());
  const layers = pairs.map((pair) => new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable));
  for (const layer of layers) {
    for (const method of ["server/discover", "tools/list", "tools/call"]) {
      layer.onRequest(method, async (params) => {
        const response = await upstream.handleMessage(method, params as Record<string, unknown>);
        if ("error" in response) throw new McpError(response.error.code, response.error.message, response.error.data);
        return response.result;
      });
    }
  }
  transports.queue.push(...pairs.map((pair) => pair.clientTransport));
  const root = defineGroup({ name: "audit", scope: ["mcp", "sdk"], children: [defineGroup({
    name: "upstream", mcp: { transport: "stdio", command: "in-memory" }, children: []
  })] });
  let downstream: ReturnType<Awaited<ReturnType<typeof createMCPServer>>["createMessageSession"]> | undefined;
  try {
    downstream = (await createMCPServer(root, { name: "audit", version: "1", projectRoot: "/repo", errorReports: false })).createMessageSession();
    const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
    expect(await downstream.handleMessage("tools/list", { _meta })).toMatchObject({ result: { tools: [{ inputSchema, outputSchema }] } });
    for (const args of [{ a: "yes" }, { a: "yes", b: 4 }]) {
      const response = await downstream.handleMessage("tools/call", { name: "audit__upstream__work", arguments: args, _meta });
      expect(response, JSON.stringify(response)).toMatchObject({ error: { code: -32602 } });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(await downstream.handleMessage("tools/call", { name: "audit__upstream__work", arguments: { a: "yes", b: 3, extra: true }, _meta }))
      .toMatchObject({ result: { resultType: "complete", structuredContent: 7 } });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual({ a: "yes", b: 3, extra: true });
  } finally {
    downstream?.close();
    await disposeMcpProxies(root);
    layers.forEach((layer) => layer.dispose()); pairs.forEach((pair) => pair.clientTransport.dispose());
    transports.queue.length = 0;
  }
});
