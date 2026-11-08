import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { S } from "toolcraft-schema";
import { ToolError } from "tiny-stdio-mcp-server";
import { defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";

type NotificationListener = Parameters<ReturnType<typeof createMCPServer>["createMessageSession"]>[0];

async function connect(server: ReturnType<typeof createMCPServer>, listener: NotificationListener) {
  const session = server.createMessageSession(listener);
  onTestFinished(() => session.close());
  await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  await session.handleMessage("notifications/initialized");
  return session;
}

describe("MCP stream notification ownership", () => {
  const unhandled: unknown[] = [];
  const observe = (reason: unknown): void => { unhandled.push(reason); };
  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", observe);
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.removeListener("unhandledRejection", observe);
    expect(unhandled).toEqual([]);
  });

  describe.each([false, true])("asynchronous sink=%s", (asynchronous) => {
    it.each(["status", "data", "end", "error"])("owns a rejected %s notification and stops the subscription", async (failedType) => {
      const failure = new Error("synthetic private sink details");
      const cleanup = vi.fn();
      const logger = vi.fn();
      const attempts: unknown[] = [];
      const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler({ status }) {
        try {
          if (failedType === "status") status({ type: "connected" });
          if (failedType === "error") throw new Error("producer failure");
          yield "ready";
        } finally { cleanup(); }
      } });
      const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false, logger }), (notification) => {
        attempts.push(notification.params?.type);
        if (notification.params?.type !== failedType) return;
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      });
      const response = await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
      expect(response).not.toHaveProperty("error");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cleanup).toHaveBeenCalledOnce();
      expect(attempts).toEqual(failedType === "end" ? ["data", "end"] : [failedType]);
      expect(logger).toHaveBeenCalledExactlyOnceWith({ level: "error", category: "runtime", message: "MCP stream notification delivery failed.", data: { subscriptionId: response.result?.subscriptionId, notificationType: failedType } });
      expect(JSON.stringify(logger.mock.calls)).not.toContain(failure.message);
      expect(await session.handleMessage("toolcraft/streams/unsubscribe", { subscriptionId: response.result?.subscriptionId })).toEqual({ result: { unsubscribed: false } });
    });

    it.each([false, true])("cancels a pending producer immediately with cleanup failure=%s", async (cleanupFails) => {
      let release: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      let signal: AbortSignal | undefined;
      const cleanup = vi.fn(() => { if (cleanupFails) throw new Error("cleanup failed"); });
      const attempts: unknown[] = [];
      const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler(context) {
        signal = context.signal;
        const abort = (): void => release();
        signal.addEventListener("abort", abort);
        try { context.status({ type: "connected" }); await pending; yield "late"; }
        finally { signal.removeEventListener("abort", abort); cleanup(); }
      } });
      const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false }), (notification) => {
        attempts.push(notification.params?.type);
        if (asynchronous) return Promise.reject(new Error("sink failed"));
        throw new Error("sink failed");
      });
      try {
        await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(signal?.aborted).toBe(true);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(attempts).toEqual(["status"]);
      } finally { release!(); session.close(); }
    });
  });

  it("observes an in-flight status rejection after session closure and cleanup", async () => {
    let rejectDelivery: (reason: unknown) => void;
    const delivery = new Promise<void>((_, reject) => { rejectDelivery = reject; });
    let markDelivery: () => void;
    const attempted = new Promise<void>((resolve) => { markDelivery = resolve; });
    const cleanup = vi.fn();
    const logger = vi.fn();
    const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler({ signal, status }) {
      try { status({ type: "connected" }); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); yield "after-close"; }
      finally { cleanup(); }
    } });
    const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false, logger }), () => { markDelivery(); return delivery; });
    await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
    await attempted;
    session.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cleanup).toHaveBeenCalledOnce();
    rejectDelivery!(new Error("late sink failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger).not.toHaveBeenCalled();
  });

  it("does not begin queued data delivery after the session closes", async () => {
    let release: () => void;
    const delivery = new Promise<void>((resolve) => { release = resolve; });
    let markDelivery: () => void;
    const attempted = new Promise<void>((resolve) => { markDelivery = resolve; });
    const notifications: unknown[] = [];
    const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler({ status }) { status({ type: "connected" }); yield "queued"; } });
    const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false }), async (notification) => {
      notifications.push(notification.params?.type);
      if (notification.params?.type === "status") { markDelivery(); await delivery; }
    });
    try {
      await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
      await attempted;
      await new Promise<void>((resolve) => setImmediate(resolve));
      session.close();
      release!();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(notifications).toEqual(["status"]);
    } finally { release!(); }
  });

  it("isolates a failed subscription while preserving ordered delivery to a healthy session", async () => {
    const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler({ status }) { status({ type: "connected" }); yield "first"; yield "second"; } });
    const server = createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false });
    const failed = await connect(server, () => Promise.reject(new Error("sink failed")));
    const notifications: unknown[] = [];
    const healthy = await connect(server, (notification) => { notifications.push(notification.params?.type); });
    await Promise.all([failed, healthy].map((session) => session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} })));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(notifications).toEqual(["status", "data", "data", "end"]);
  });

  it("preserves an explicit unsubscribe cleanup failure for its caller", async () => {
    let release: (value: IteratorResult<string>) => void;
    const pending = new Promise<IteratorResult<string>>((resolve) => { release = resolve; });
    let markStarted: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const failure = new ToolError(-32602, "explicit unsubscribe cleanup failed");
    const cleanup = vi.fn(async () => { throw failure; });
    const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), handler: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => { markStarted(); return pending; }, return: cleanup })
    }) });
    const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false }), () => {});
    try {
      const subscription = await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
      await started;
      expect(await session.handleMessage("toolcraft/streams/unsubscribe", { subscriptionId: subscription.result?.subscriptionId })).toEqual({ error: { code: -32602, message: failure.message } });
      expect(cleanup).toHaveBeenCalledOnce();
    } finally { release!({ done: true, value: undefined }); session.close(); }
  });

  it.each([undefined, null, "sink failed"])("owns a non-Error rejection: %s", async (failure) => {
    const logger = vi.fn();
    const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler() { yield "ready"; } });
    const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false, logger }), () => Promise.reject(failure));
    await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger).toHaveBeenCalledOnce();
  });

  it("does not let a failing diagnostic sink escape background delivery cleanup", async () => {
    const cleanup = vi.fn();
    const logger = vi.fn(() => { throw new Error("diagnostic sink failed"); });
    const command = defineStreamCommand({ name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async *handler() { try { yield "ready"; } finally { cleanup(); } } });
    const session = await connect(createMCPServer(defineGroup({ name: "audit", children: [command] }), { name: "audit", version: "1", errorReports: false, logger }), () => Promise.reject(new Error("notification sink failed")));
    await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
