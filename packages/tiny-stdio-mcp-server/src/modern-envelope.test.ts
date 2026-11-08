import { expect, it } from "vitest";
import { parseMessage } from "./jsonrpc.js";
import { createServer } from "./index.js";

const _meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

it.each([null, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects modern wire ID %s", (id) => {
  expect(
    parseMessage(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: { _meta } }))
  ).toMatchObject({ success: false, error: { code: -32600 } });
});

it.each([1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid request context ID %s",
  async (requestId) => {
    const server = createServer({ name: "ids", version: "1" });
    expect(await server.handleMessage("tools/list", { _meta }, { requestId })).toMatchObject({
      error: { code: -32600 }
    });
  }
);

it.each([0, -1, "", "1"])("accepts modern wire ID %j", (id) => {
  expect(
    parseMessage(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: { _meta } }))
  ).toMatchObject({ success: true, request: { id } });
});

import { PassThrough } from "node:stream";
import { vi } from "vitest";
import { defineSchema, type SDKTransport } from "./index.js";

it("rejects a null modern ID received through an SDK transport", async () => {
  const server = createServer({ name: "sdk-ids", version: "1" });
  const send = vi.fn(async () => {});
  const transport: SDKTransport = { start: async () => {}, close: async () => {}, send };
  const connected = server.connectSDK(transport);
  try {
    await transport.onmessage?.({
      jsonrpc: "2.0",
      id: null,
      method: "tools/list",
      params: { _meta }
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: -32600 }) })
    );
  } finally {
    transport.onclose?.();
    await connected;
  }
});

it("does not execute modern tool calls sent without a request ID", async () => {
  const server = createServer({ name: "notifications", version: "1" });
  const handler = vi.fn(() => "done");
  server.tool("side-effect", "Side effect", defineSchema({}), handler);
  const readable = new PassThrough();
  const writable = new PassThrough();
  writable.resume();
  const connected = server.connect({ readable, writable });
  readable.end(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "side-effect", _meta }
    }) + "\n"
  );
  await connected;
  writable.destroy();
  expect(handler).not.toHaveBeenCalled();
});
