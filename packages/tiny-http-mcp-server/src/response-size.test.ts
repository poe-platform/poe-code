import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { createServer, defineSchema, StreamableHttpTransport } from "./index.js";

it.each([
  { modern: true, enableJsonResponse: true }, { modern: true, enableJsonResponse: false },
  { modern: false, enableJsonResponse: true }, { modern: false, enableJsonResponse: false }
])("rejects oversized UTF-8 tool responses before writing with %j", async ({ modern, enableJsonResponse }) => {
  const handler = vi.fn(() => "🦊".repeat(100));
  const server = createServer({ name: "size", version: "1" }).tool("large", "Large", defineSchema({}), handler);
  if (!modern) await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  const transport = new StreamableHttpTransport(server, { enableJsonResponse, sessionIdGenerator: undefined, maxResponseBytes: 256 });
  const request = Object.assign(Readable.from([JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "large", arguments: {},
      ...(modern ? { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } : {})
    }
  })]), {
    method: "POST", url: "/mcp", socket: {}, headers: {
      host: "localhost", "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(modern ? { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "large" } : {})
    }
  }) as IncomingMessage;
  const frames: string[] = [];
  const response = Object.assign(new Writable({ write(chunk, _encoding, callback) {
    frames.push(chunk.toString()); callback();
  } }), { writeHead: vi.fn(), flushHeaders: vi.fn(), statusCode: 200 }) as unknown as ServerResponse;
  try {
    await transport.handleRequest(request, response);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.destroyed).toBe(true);
    expect(frames).toHaveLength(0);
    expect(response.writeHead).not.toHaveBeenCalled();
  } finally { response.destroy(); await transport.close(); }
});
