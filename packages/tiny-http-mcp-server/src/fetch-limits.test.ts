import { describe, expect, it } from "vitest";
import { createFetchServer, defineSchema } from "./fetch.js";

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run", arguments: {} } });

describe("Fetch admission limits", () => {
  it("cancels a body once its actual streamed size exceeds the bound", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(32)); },
      cancel() { cancelled = true; }
    });
    const server = createFetchServer({ name: "limits", version: "1", maxRequestBytes: 40 });
    const response = await server.fetch(new Request("https://example.com/mcp", {
      method: "POST", headers, body: stream, duplex: "half"
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("bounds response bytes", async () => {
    const server = createFetchServer({ name: "limits", version: "1", maxResponseBytes: 128 })
      .tool("run", "Run", defineSchema({}), () => "x".repeat(1024));
    const response = await server.fetch(new Request("https://example.com/mcp", { method: "POST", headers, body }));
    expect((await response.json()).error.message).toBe("Response exceeds byte limit");
  });

  it("shares tool admission across caller lifecycles", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const server = createFetchServer({ name: "limits", version: "1", maxConcurrentToolCalls: 1, maxQueuedToolCalls: 0 })
      .tool("run", "Run", defineSchema({}), async () => { entered(); await blocked; return "done"; });
    const first = server.fetch(new Request("https://example.com/mcp", { method: "POST", headers, body }));
    await started;
    try {
      const second = await server.fetch(new Request("https://example.com/mcp", { method: "POST", headers, body }));
      expect((await second.json()).error.code).toBe(-32000);
    } finally { release(); await first; }
  });
});
