import "../vitest.setup.js";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { createHttpServer } from "./index.js";

it.each([
  { stateless: false, maxStreamBufferBytes: undefined },
  { stateless: true, maxStreamBufferBytes: undefined },
  { stateless: true, maxStreamBufferBytes: 0 },
  { stateless: true, maxStreamBufferBytes: 4 }
])(
  "flushes and filters modern subscription streams with %j",
  async ({ stateless, maxStreamBufferBytes }) => {
    const server = createHttpServer({
      name: "stream",
      version: "1",
      enableJsonResponse: true,
      maxStreamBufferBytes,
      ...(stateless ? { sessionIdGenerator: undefined } : {})
    });
    const handle = await server.listenHttp();
    const controller = new AbortController();
    let received: Response | undefined;
    const pending = fetch(handle.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "subscriptions/listen"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tools",
        method: "subscriptions/listen",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {}
          },
          notifications: { toolsListChanged: true }
        }
      })
    }).then(
      (response) => {
        received = response;
      },
      () => {}
    );
    try {
      await setImmediate();
      expect(received).toBeDefined();
      const reader = received!.body!.getReader();
      const decoder = new TextDecoder();
      const acknowledged = decoder.decode((await reader.read()).value);
      expect(acknowledged).toContain('"method":"notifications/subscriptions/acknowledged"');
      expect(acknowledged).toContain('"toolsListChanged":true');
      expect(received!.headers.get("x-accel-buffering")).toBe("no");
      await server.notifyToolsChanged();
      expect(decoder.decode((await reader.read()).value)).toContain(
        '"io.modelcontextprotocol/subscriptionId":"tools"'
      );
    } finally {
      controller.abort();
      await pending;
      await handle.close();
    }
  }
);

it("cancels disconnected HTTP work and retains capacity until its handler settles", async () => {
  const server = createHttpServer({
    name: "disconnect",
    version: "1",
    enableJsonResponse: true,
    maxActiveRequests: 1
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signal: AbortSignal | undefined;
  server.method("held", async (_params, context) => {
    signal = context.signal;
    await gate;
    return {};
  });
  const handle = await server.listenHttp();
  const controller = new AbortController();
  const send = (method: string, requestSignal?: AbortSignal) =>
    fetch(handle.url, {
      method: "POST",
      signal: requestSignal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {}
          }
        }
      })
    });
  const held = send("held", controller.signal).catch(() => undefined);
  try {
    await setImmediate();
    expect(signal?.aborted).toBe(false);
    controller.abort();
    await held;
    expect(signal?.aborted).toBe(true);
    const busy = await send("tools/list");
    expect(await busy.json()).toMatchObject({ error: { code: -32000 } });
    release();
    await setImmediate();
    expect(await (await send("tools/list")).json()).toMatchObject({
      result: { resultType: "complete" }
    });
  } finally {
    release();
    controller.abort();
    await held;
    await handle.close();
  }
});

import { vi } from "vitest";

it("emits modern subscription keepalive comments and releases the timer on cancellation", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const server = createHttpServer({
    name: "keepalive",
    version: "1",
    sessionIdGenerator: undefined,
    sseKeepAliveMs: 10
  });
  const handle = await server.listenHttp();
  const controller = new AbortController();
  try {
    const response = await fetch(handle.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "subscriptions/listen"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "subscriptions/listen",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {}
          },
          notifications: {}
        }
      })
    });
    const reader = response.body!.getReader();
    await reader.read();
    let keepalive: Uint8Array | undefined;
    const reading = reader.read().then((result) => {
      keepalive = result.value;
    });
    vi.advanceTimersByTime(10);
    await setImmediate();
    expect(keepalive).toBeDefined();
    expect(new TextDecoder().decode(keepalive)).toBe(": keepalive\n\n");
    controller.abort();
    await reading;
    await setImmediate();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    controller.abort();
    await handle.close();
    vi.useRealTimers();
  }
});
