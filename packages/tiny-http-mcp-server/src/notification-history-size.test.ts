import "../vitest.setup.js";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { createHttpServer } from "./index.js";

it("does not retain oversized notifications that prevent replay of later events", async () => {
  const server = createHttpServer({ name: "history", version: "1", enableJsonResponse: true, maxResponseBytes: 1024, maxStreamsPerSession: 1, sseKeepAliveMs: 0 });
  server.method("emit", async (params, session) => {
    await session.notify("notifications/message", { level: "info", data: params?.data });
    return {};
  });
  const handle = await server.listenHttp();
  let sessionId: string | undefined;
  let nextId = 1;
  const post = (method: string, params?: Record<string, unknown>) => fetch(handle.url, {
    method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-03-26" })
    }, body: JSON.stringify({ jsonrpc: "2.0", ...(method.startsWith("notifications/") ? {} : { id: nextId++ }), method, params })
  });
  const controller = new AbortController();
  try {
    const initialized = await post("initialize", { protocolVersion: "2025-03-26" });
    sessionId = initialized.headers.get("mcp-session-id")!;
    await initialized.arrayBuffer();
    expect(sessionId).toBeTruthy();
    await (await post("notifications/initialized")).arrayBuffer();
    const stream = await fetch(handle.url, { headers: { accept: "text/event-stream", "mcp-session-id": sessionId }, signal: controller.signal });
    await (await post("emit", { data: "🦊".repeat(1000) })).arrayBuffer();
    await stream.body?.cancel().catch(() => undefined);
    await setImmediate();
    await (await post("emit", { data: "after" })).arrayBuffer();
    const replay = await fetch(handle.url, {
      headers: { accept: "text/event-stream", "mcp-session-id": sessionId, "last-event-id": "0" }, signal: controller.signal
    });
    const reader = replay.body!.getReader();
    try {
      expect(replay.status).toBe(200);
      const next = await reader.read();
      expect(next.done).toBe(false);
      expect(new TextDecoder().decode(next.value)).toContain('"data":"after"');
      expect(new TextDecoder().decode(next.value)).not.toContain("🦊");
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } finally { controller.abort(); await handle.close(); }
});
