import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { expect, it, onTestFinished, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";

const _meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

it("enforces active request limits for direct legacy SDK calls without a context", async () => {
  const server = createServer({ name: "legacy-capacity", version: "1", maxActiveRequests: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  server.tool("held", "Held", defineSchema({}), async () => {
    started();
    await gate;
    return "done";
  });
  onTestFinished(() => release());
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  const first = server.handleMessage("tools/call", { name: "held" });
  await entered;
  expect(await server.handleMessage("tools/list")).toMatchObject({ error: { code: -32000 } });
  release();
  await first;
  expect(await server.handleMessage("tools/list")).toHaveProperty("result");
});

it("removes a cancelled tool request from admission before it can start", async () => {
  const server = createServer({ name: "cancel", version: "1", maxConcurrentToolCalls: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = vi.fn(async () => {
    await gate;
    return "done";
  });
  server.tool("held", "Held", defineSchema({}), handler);
  const session = server.createMessageSession();
  onTestFinished(() => {
    release();
    session.close();
  });
  const first = session.handleMessage("tools/call", { _meta, name: "held" }, { requestId: 1 });
  await setImmediate();
  const queued = session.handleMessage("tools/call", { _meta, name: "held" }, { requestId: 2 });
  await setImmediate();
  await session.handleMessage("notifications/cancelled", { requestId: 2 });
  expect(await queued).toEqual({ result: undefined });
  release();
  await first;
  await setImmediate();
  expect(handler).toHaveBeenCalledTimes(1);
});

it("ends subscriptions at input EOF and preserves pending ordinary responses", async () => {
  const server = createServer({ name: "eof", version: "1" });
  const readable = new PassThrough();
  const writable = new PassThrough();
  const messages: unknown[] = [];
  writable.on("data", (chunk) => messages.push(JSON.parse(chunk.toString())));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.method("held", async () => {
    await gate;
    return { value: "done" };
  });
  const connected = server.connect({ readable, writable });
  onTestFinished(() => {
    release();
    readable.destroy();
    writable.destroy();
  });
  readable.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscriptions/listen",
      params: { _meta, notifications: {} }
    }) + "\n"
  );
  readable.write(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "held", params: { _meta } }) + "\n"
  );
  await setImmediate();
  readable.end();
  await setImmediate();
  release();
  await connected;
  expect(messages).toContainEqual(
    expect.objectContaining({ id: 2, result: expect.objectContaining({ value: "done" }) })
  );
});

it("retains capacity for cancelled noncooperative work until it settles", async () => {
  const server = createServer({ name: "capacity", version: "1", maxActiveRequests: 1 });
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
  const session = server.createMessageSession();
  onTestFinished(() => {
    release();
    session.close();
  });
  const held = session.handleMessage("held", { _meta }, { requestId: "held" });
  await session.handleMessage("notifications/cancelled", { requestId: "held" });
  expect(signal?.aborted).toBe(true);
  expect(await held).toEqual({ result: undefined });
  expect(await session.handleMessage("tools/list", { _meta }, { requestId: 2 })).toMatchObject({
    error: { code: -32000 }
  });
  release();
  await setImmediate();
  expect(await session.handleMessage("tools/list", { _meta }, { requestId: 2 })).toHaveProperty(
    "result"
  );
});

it("rejects duplicate active IDs without replacing the original cancellation owner", async () => {
  const server = createServer({ name: "duplicates", version: "1" });
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
  const session = server.createMessageSession();
  onTestFinished(() => {
    release();
    session.close();
  });
  const held = session.handleMessage("held", { _meta }, { requestId: 1 });
  expect(await session.handleMessage("tools/list", { _meta }, { requestId: 1 })).toMatchObject({
    error: { code: -32600 }
  });
  await session.handleMessage("notifications/cancelled", { requestId: 1 });
  expect(signal?.aborted).toBe(true);
  expect(await held).toEqual({ result: undefined });
});

it("cancels request work when the caller disconnects", async () => {
  const server = createServer({ name: "disconnect", version: "1" });
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
  const caller = new AbortController();
  const session = server.createMessageSession();
  onTestFinished(() => {
    release();
    session.close();
  });
  const held = session.handleMessage("held", { _meta }, { requestId: 1, signal: caller.signal });
  caller.abort();
  expect(await held).toEqual({ result: undefined });
  expect(signal?.aborted).toBe(true);
});
