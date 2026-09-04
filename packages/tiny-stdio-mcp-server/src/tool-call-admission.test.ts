import { setImmediate } from "node:timers/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";
import { ToolCallAdmission } from "./tool-call-admission.js";

describe("shared tool-call admission", () => {
  it("bounds handlers received through the stdio line protocol", async () => {
    const server = createServer({ name: "stdio-admission", version: "1" });
    const readable = new PassThrough();
    const writable = new PassThrough();
    let output = "";
    writable.on("data", chunk => { output += chunk.toString(); });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    server.tool("held", "Held work", defineSchema({}), async () => { started++; await gate; return "done"; });
    const connected = server.connect({ readable, writable });
    readable.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }) + "\n");
    await setImmediate();
    for (let id = 1; id <= 8; id++) {
      readable.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "held" } }) + "\n");
    }
    try {
      await setImmediate();
      expect(started).toBe(4);
      release();
      await setImmediate();
      expect(started).toBe(8);
      const responses = output.trim().split("\n").map(line => JSON.parse(line));
      expect(responses).toHaveLength(9);
      expect(responses.every(response => "result" in response)).toBe(true);
    } finally {
      release();
      readable.end();
      await connected;
      writable.destroy();
    }
  });

  it("rejects invalid active and queued capacities", () => {
    for (const maxConcurrentToolCalls of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createServer({ name: "invalid", version: "1", maxConcurrentToolCalls })).toThrow(
        "maxConcurrentToolCalls must be a safe integer greater than or equal to 1."
      );
    }
    for (const maxQueuedToolCalls of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createServer({ name: "invalid", version: "1", maxQueuedToolCalls })).toThrow(
        "maxQueuedToolCalls must be a safe integer greater than or equal to 0."
      );
    }
  });

  it("allows 64 waiting calls by default and rejects the next without invoking it", async () => {
    const server = createServer({ name: "default-queue", version: "1" });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    server.tool("held", "Held test work", defineSchema({}), async () => { started++; await gate; return "done"; });
    await server.handleMessage("initialize", {});
    const calls = Array.from({ length: 69 }, () => server.handleMessage("tools/call", { name: "held", arguments: {} }));
    try {
      await setImmediate();
      expect(started).toBe(4);
      expect(await calls[68]).toMatchObject({ error: { code: -32000, message: "Too many queued tool calls" } });
      release();
      const results = await Promise.all(calls);
      expect(started).toBe(68);
      expect(results.filter(result => "result" in result)).toHaveLength(68);
    } finally { release(); await Promise.all(calls); }
  });

  it("does not queue invalid requests and permits a zero waiting capacity", async () => {
    const server = createServer({ name: "zero-queue", version: "1", maxConcurrentToolCalls: 1, maxQueuedToolCalls: 0 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.tool("held", "Held test work", defineSchema({ id: { type: "number" } }), async () => { await gate; return "done"; });
    await server.handleMessage("initialize", {});
    const first = server.handleMessage("tools/call", { name: "held", arguments: { id: 1 } });
    try {
      expect(await server.handleMessage("tools/call", { name: "held", arguments: { id: 2 } })).toMatchObject({ error: { code: -32000 } });
      expect(await server.handleMessage("tools/call", { name: "missing", arguments: {} })).toMatchObject({ error: { code: -32602 } });
      expect(await server.handleMessage("tools/call", { name: "held", arguments: { id: "bad" } })).toMatchObject({ error: { code: -32602 } });
      expect(await server.handleMessage("ping")).toEqual({ result: {} });
    } finally { release(); await first; }
  });

  for (const closeAfterRelease of [false, true]) it(`cancels closed-session waiting calls, after releasing prior work ${closeAfterRelease}`, async () => {
    const server = createServer({ name: "closed-queue", version: "1", maxConcurrentToolCalls: 1, maxQueuedToolCalls: 1 });
    const sessions = [server.createMessageSession(), server.createMessageSession()];
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.tool("held", "Held test work", defineSchema({ label: { type: "string" } }), async ({ label }) => {
      started.push(label); await gate; return "done";
    });
    await Promise.all(sessions.map(session => session.handleMessage("initialize", {})));
    const first = sessions[0]!.handleMessage("tools/call", { name: "held", arguments: { label: "first" } });
    const cancelled = sessions[1]!.handleMessage("tools/call", { name: "held", arguments: { label: "cancelled" } });
    try {
      await setImmediate();
      if (closeAfterRelease) release();
      sessions[1]!.close();
      expect(await cancelled).toMatchObject({ result: { isError: true } });
      expect(started).toEqual(["first"]);
      const next = sessions[0]!.handleMessage("tools/call", { name: "held", arguments: { label: "next" } });
      release();
      expect(await next).toHaveProperty("result");
      expect(started).toEqual(["first", "next"]);
    } finally {
      release(); await Promise.all([first, cancelled]);
      for (const session of sessions) session.close();
    }
  });

  it("releases handed-off capacity if the session closes before the handler resumes", async () => {
    const server = createServer({ name: "closed-handoff", version: "1", maxConcurrentToolCalls: 1 });
    const session = server.createMessageSession();
    await session.handleMessage("initialize", {});
    const handler = vi.fn(() => "must not run");
    server.tool("effect", "Effect", defineSchema({}), handler);
    const acquire = ToolCallAdmission.prototype.acquire;
    const spy = vi.spyOn(ToolCallAdmission.prototype, "acquire").mockImplementation(function (this: ToolCallAdmission, signal) {
      return acquire.call(this, signal).then(release => { session.close(); return release; });
    });
    try {
      expect(await session.handleMessage("tools/call", { name: "effect" })).toMatchObject({ result: { isError: true } });
      expect(handler).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); session.close(); }
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "effect" })).toHaveProperty("result");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("reuses capacity after falsey synchronous and asynchronous handler failures", async () => {
    const server = createServer({ name: "failed-handler", version: "1", maxConcurrentToolCalls: 1, maxQueuedToolCalls: 0 });
    server.tool("sync", "Synchronous failure", defineSchema({}), () => { throw 0; });
    server.tool("async", "Asynchronous failure", defineSchema({}), async () => { throw false; });
    server.tool("ok", "Success", defineSchema({}), () => "done");
    await server.handleMessage("initialize", {});
    expect(await server.handleMessage("tools/call", { name: "sync" })).toMatchObject({ result: { isError: true } });
    expect(await server.handleMessage("tools/call", { name: "async" })).toMatchObject({ result: { isError: true } });
    expect(await server.handleMessage("tools/call", { name: "ok" })).toMatchObject({ result: { content: [{ type: "text", text: "done" }] } });
  });

  it("starts only four handlers by default and admits queued calls after settlement", async () => {
    const server = createServer({ name: "default-admission", version: "1" });
    const started: number[] = [];
    const releases: (() => void)[] = [];
    const gates = Array.from({ length: 8 }, () => new Promise<void>(resolve => releases.push(resolve)));
    server.tool("held", "Held test work", defineSchema({ id: { type: "number" } }), async ({ id }) => {
      started.push(id);
      await gates[id];
      return "done";
    });
    await server.handleMessage("initialize", {});
    const calls = gates.map((_, id) => server.handleMessage("tools/call", { name: "held", arguments: { id } }));
    try {
      await setImmediate();
      expect(started).toEqual([0, 1, 2, 3]);
      for (const release of releases.slice(0, 4)) release();
      await setImmediate();
      expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    } finally {
      for (const release of releases) release();
      await Promise.all(calls);
    }
  });

  it("shares configured capacity and bounded FIFO waiting across message sessions", async () => {
    const server = createServer({ name: "shared-admission", version: "1", maxConcurrentToolCalls: 2, maxQueuedToolCalls: 2 });
    const sessions = [server.createMessageSession(), server.createMessageSession()];
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.tool("held", "Held test work", defineSchema({ id: { type: "number" } }), async ({ id }) => {
      started.push(id);
      await gate;
      return "done";
    });
    await Promise.all(sessions.map(session => session.handleMessage("initialize", {})));
    const calls = Array.from({ length: 5 }, (_, id) => sessions[id % 2]!.handleMessage("tools/call", { name: "held", arguments: { id } }));
    try {
      await setImmediate();
      expect(started).toEqual([0, 1]);
      expect(await calls[4]).toMatchObject({ error: { code: -32000, message: "Too many queued tool calls" } });
      release();
      await Promise.all(calls);
      expect(started).toEqual([0, 1, 2, 3]);
    } finally {
      release();
      await Promise.all(calls);
      for (const session of sessions) session.close();
    }
  });

  it("retains active capacity after response timeout and never starts an expired queued call", async () => {
    vi.useFakeTimers();
    const server = createServer({ name: "timeout-admission", version: "1", maxConcurrentToolCalls: 1, maxQueuedToolCalls: 1, toolCallTimeoutMs: 5 });
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.tool("held", "Held test work", defineSchema({}), async () => { started++; await gate; return "done"; });
    await server.handleMessage("initialize", {});
    const first = server.handleMessage("tools/call", { name: "held", arguments: {} });
    let second: ReturnType<typeof server.handleMessage> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(5);
      expect(await first).toMatchObject({ error: { message: "Tool call timed out: held" } });
      second = server.handleMessage("tools/call", { name: "held", arguments: {} });
      await vi.advanceTimersByTimeAsync(5);
      expect(await second).toMatchObject({ error: { message: "Tool call timed out: held" } });
      expect(started).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(1);
      expect(await server.handleMessage("tools/call", { name: "held", arguments: {} })).toHaveProperty("result");
      expect(started).toBe(2);
    } finally {
      release();
      await first;
      await second;
      vi.useRealTimers();
    }
  });
});
