import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";
import { createManagedStream } from "./stream.js";
import { runCLI } from "./cli.js";

describe("managed stream terminal lifecycle", () => {
  it.each([false, true])("detaches the consumer after startup failure with synchronous=%s", async (synchronous) => {
    const controller = new AbortController();
    const failure = new Error("startup failed");
    const create = vi.fn(() => {
      if (synchronous) throw failure;
      return Promise.reject(failure);
    });
    const stream = createManagedStream({ eventSchema: S.String(), signal: controller.signal, create });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBe(failure);
    expect(stream.signal.aborted).toBe(true);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await expect(stream.cancel()).resolves.toBeUndefined();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("closes an iterator acquired after cancellation without pulling a value", async () => {
    let completeCreation: (iterable: AsyncIterable<string>) => void;
    const creating = new Promise<AsyncIterable<string>>((resolve) => { completeCreation = resolve; });
    const next = vi.fn(async () => ({ done: false as const, value: "late" }));
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const create = vi.fn(() => creating);
    const stream = createManagedStream({ eventSchema: S.String(), create });
    const pending = stream[Symbol.asyncIterator]().next();
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(1);
    const cancelled = stream.cancel();
    expect(stream.signal.aborted).toBe(true);
    completeCreation!({ [Symbol.asyncIterator]: () => ({ next, return: cleanup }) });

    await cancelled;
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(next).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("discards a value that arrives after cancellation", async () => {
    let completeNext: (result: IteratorResult<string>) => void;
    const pendingValue = new Promise<IteratorResult<string>>((resolve) => { completeNext = resolve; });
    let started: () => void;
    const pulling = new Promise<void>((resolve) => { started = resolve; });
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const stream = createManagedStream({
      eventSchema: S.String(),
      create: async () => ({ [Symbol.asyncIterator]: () => ({ next: () => { started(); return pendingValue; }, return: cleanup }) })
    });
    const pending = stream[Symbol.asyncIterator]().next();
    await pulling;
    await stream.cancel();
    completeNext!({ done: false, value: "late" });

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("shares cleanup with reentrant cancellation from an abort listener", async () => {
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const stream = createManagedStream({
      eventSchema: S.String(),
      create: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false as const, value: "ready" }), return: cleanup }) })
    });
    await stream[Symbol.asyncIterator]().next();
    let reentrant: Promise<void> | undefined;
    stream.signal.addEventListener("abort", () => { reentrant = stream.cancel(); }, { once: true });

    await stream.cancel();
    await reentrant;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up when creation synchronously requests cancellation", async () => {
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const next = vi.fn(async () => ({ done: false as const, value: "late" }));
    const stream = createManagedStream({
      eventSchema: S.String(),
      create: async () => {
        void stream.cancel();
        return { [Symbol.asyncIterator]: () => ({ next, return: cleanup }) };
      }
    });

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({ done: true, value: undefined });
    await stream.cancel();
    expect(next).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(["cancel", "return"] as const)("preserves explicitly awaited %s cleanup failures", async (method) => {
    const failure = new Error("cleanup failed");
    const cleanup = vi.fn(async () => { throw failure; });
    const stream = createManagedStream({
      eventSchema: S.String(),
      create: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false as const, value: "ready" }), return: cleanup }) })
    });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    await expect(method === "cancel" ? stream.cancel() : iterator.return!()).rejects.toBe(failure);
    await expect(stream.cancel()).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not initialize a stream cancelled before its first pull", async () => {
    const create = vi.fn(async function* () { yield "unexpected"; });
    const stream = createManagedStream({ eventSchema: S.String(), create: async () => create() });
    await stream.cancel();
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({ done: true, value: undefined });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not return an iterator again after normal completion", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const stream = createManagedStream({
      eventSchema: S.String(), signal: controller.signal,
      create: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }), return: cleanup }) })
    });
    await stream[Symbol.asyncIterator]().next();
    await stream.cancel();
    expect(cleanup).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});

describe("public stream rejection ownership", () => {
  it.each(["startup", "cleanup"] as const)("does not re-emit an SDK %s failure during external abort", async (phase) => {
    const controller = new AbortController();
    const failure = new Error(`${phase} failed`);
    const cleanup = vi.fn(() => { throw failure; });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    const root = defineGroup({ name: "audit", children: [defineStreamCommand({
      name: "watch", params: S.Object({}), event: S.String(),
      handler: phase === "startup"
        ? async () => { throw failure; }
        : async function* () { try { yield "ready"; } finally { cleanup(); } }
    })] });
    const stream = createSDK(root, { errorReports: false }).watch({}, { signal: controller.signal });
    process.on("unhandledRejection", onUnhandled);
    try {
      const first = stream[Symbol.asyncIterator]().next();
      if (phase === "startup") await expect(first).rejects.toBe(failure);
      else await expect(first).resolves.toEqual({ done: false, value: "ready" });
      controller.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      if (phase === "cleanup") await expect(stream.cancel()).rejects.toBe(failure);
      else await expect(stream.cancel()).resolves.toBeUndefined();
    } finally {
      await stream.cancel().catch(() => undefined);
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it.each(["startup", "cleanup"] as const)("reports an MCP %s error without an unhandled pump-cleanup rejection", async (phase) => {
    const failure = new Error(`${phase} failed`);
    const unhandled: unknown[] = [];
    const notifications: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    const root = defineGroup({ name: "audit", children: [defineStreamCommand({
      name: "watch", scope: ["mcp"], params: S.Object({}), event: S.String(), async handler() {
        if (phase === "startup") throw failure;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => { throw new Error("iteration failed"); },
            return: async () => { throw failure; }
          })
        };
      }
    })] });
    const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false })
      .createMessageSession((message) => { notifications.push(message.params); });
    process.on("unhandledRejection", onUnhandled);
    try {
      await session.handleMessage("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      await session.handleMessage("notifications/initialized");
      const response = await session.handleMessage("toolcraft/streams/subscribe", { name: "audit__watch", arguments: {} });
      expect(response).not.toHaveProperty("error");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(notifications).toEqual([expect.objectContaining({ type: "error", error: failure.message })]);
      expect(unhandled).toEqual([]);
    } finally {
      session.close();
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("observes SIGINT cleanup rejection while a CLI pull is pending", async () => {
    const failure = new Error("CLI cleanup failed");
    const cleanup = vi.fn(async () => { throw failure; });
    let finishNext: (result: IteratorResult<string>) => void;
    const pendingValue = new Promise<IteratorResult<string>>((resolve) => { finishNext = resolve; });
    let started: () => void;
    const pulling = new Promise<void>((resolve) => { started = resolve; });
    const root = defineGroup({ name: "audit", children: [defineStreamCommand({
      name: "watch", scope: ["cli"], params: S.Object({}), event: S.String(),
      async handler() {
        return { [Symbol.asyncIterator]: () => ({ next: () => { started(); return pendingValue; }, return: cleanup }) };
      }
    })] });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    const output: string[] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    process.on("unhandledRejection", onUnhandled);
    const run = runCLI(root, { argv: ["node", "audit", "watch"], errorReports: false, outputEmitter: (entry) => output.push(entry) });
    try {
      await pulling;
      process.emit("SIGINT");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      finishNext!({ done: true, value: undefined });
      await run;
      process.exitCode = previousExitCode;
      process.removeListener("unhandledRejection", onUnhandled);
    }
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(output.join("\n")).toContain(failure.message);
  });
});
