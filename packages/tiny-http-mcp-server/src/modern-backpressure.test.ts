import { Readable, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { createServer, StreamableHttpTransport } from "./index.js";

it("rejects an oversized modern frame before writing and releases subscription capacity", async () => {
  const _meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {}
  };
  const server = createServer({ name: "backpressure", version: "1", maxActiveRequests: 1 });
  const transport = new StreamableHttpTransport(server, { maxResponseBytes: 4 });
  const request = Object.assign(
    Readable.from([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "subscriptions/listen",
        params: { _meta, notifications: { toolsListChanged: true } }
      })
    ]),
    {
      method: "POST",
      url: "/mcp",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "subscriptions/listen"
      },
      socket: {}
    }
  ) as IncomingMessage;
  const frames: string[] = [];
  let release: (() => void) | undefined;
  const response = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        frames.push(chunk.toString());
        release = callback;
      }
    }),
    {
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      statusCode: 200
    }
  ) as unknown as ServerResponse;
  const handled = transport.handleRequest(request, response);
  try {
    await setImmediate();
    expect(frames).toHaveLength(0);
    expect(response.writableLength).toBeLessThanOrEqual(4);
    await server.notifyToolsChanged();
    await handled;
    expect(response.destroyed).toBe(true);
    expect(frames).toHaveLength(0);
    expect(await server.handleMessage("tools/list", { _meta }, { requestId: 2 })).toHaveProperty(
      "result"
    );
  } finally {
    release?.();
    response.destroy();
    await transport.close();
    await handled;
  }
});
