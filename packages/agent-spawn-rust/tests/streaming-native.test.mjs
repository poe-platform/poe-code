import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { EventQueue } from "../dist/event-queue.js";
test("stream delivery abandonment releases unread objects and settles pending readers", async () => {
  const q = new EventQueue();
  q.push({ opaque: true });
  q.abandon();
  assert.equal(q.values.size, 0);
  assert.deepEqual(await q.next(), { done: true, value: undefined });
  q.push({ later: true });
  assert.equal(q.values.size, 0);
  const live = new EventQueue(),
    pending = live.next();
  live.abandon();
  assert.deepEqual(await pending, { done: true, value: undefined });
});

const fs = await import("node:fs"),
  cp = await import("node:child_process"),
  module = await import("node:module");
const { Volume, createFsFromVolume } = await import("memfs"),
  { EventEmitter } = await import("node:events"),
  { PassThrough } = await import("node:stream");
const own = await import("../dist/index.js"),
  original = await import("../../agent-spawn/dist/index.js");
const volume = new Volume(),
  memory = createFsFromVolume(volume);
let output = [];
for (const key of ["existsSync", "readFileSync"])
  mock.method(fs.default, key, memory[key].bind(memory));
mock.method(cp.default, "spawn", () => {
  const child = new EventEmitter();
  child.unref = () => {};
  child.stdin = new PassThrough();
  child.stdin.resume();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    child.emit("close", 1, signal);
    return true;
  };
  setImmediate(() => {
    for (const chunk of output) child.stdout.write(chunk);
    child.stdout.end();
    child.stderr.end("diagnostic\n");
    child.emit("close", 0, null);
  });
  return child;
});
for (const key of [
  "lstat",
  "mkdir",
  "readFile",
  "writeFile",
  "rename",
  "unlink",
  "readdir",
  "stat",
  "rm"
])
  mock.method(fs.default.promises, key, memory.promises[key].bind(memory.promises));
module.syncBuiltinESMExports();
async function collect(events) {
  const values = [];
  for await (const value of events) {
    const { _meta, ...rest } = value;
    assert.equal(typeof _meta.ts, "number");
    values.push(rest);
  }
  return values;
}
test("streaming normalizes split CRLF and final lines with equivalent middleware histories", async () => {
  const text = [
    { type: "thread.started", thread_id: "thread" },
    { type: "item.completed", item: { type: "agent_message", text: "hello 😀" } },
    { type: "turn.completed", usage: { input_tokens: 3, output_tokens: 4, cached_input_tokens: 0 } }
  ]
    .map(JSON.stringify)
    .join("\r\n");
  const bytes = Buffer.from(text);
  output = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, index) =>
    bytes.subarray(index * 7, (index + 1) * 7)
  );
  const records = [];
  for (const api of [original, own]) {
    let ctx;
    const handle = api.spawnStreaming({
      agentId: "codex",
      prompt: "private",
      cwd: "/work",
      middlewares: [
        async (context, next) => {
          ctx = context;
          await next();
        }
      ]
    });
    const [events, result] = await Promise.all([collect(handle.events), handle.done]);
    records.push({
      events,
      result,
      history: ctx.events.map((event) =>
        Object.fromEntries(Object.entries(event).filter(([key]) => key !== "_meta"))
      ),
      usage: ctx.usage,
      sessionId: ctx.sessionId,
      mode: ctx.mode
    });
  }
  assert.deepEqual(records[1], records[0]);
  assert.equal(records[1].events.length, 3);
  assert.equal(records[1].sessionId, "thread");
});
test("streaming delivery can close before production while preserving middleware transcript", async () => {
  output = [
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "after close" }
    }) + "\n"
  ];
  for (const api of [original, own]) {
    let ctx;
    const handle = api.spawnStreaming({
      agentId: "codex",
      prompt: "private",
      cwd: "/work",
      middlewares: [
        async (context, next) => {
          ctx = context;
          await context.eventStream[Symbol.asyncIterator]().return();
          await next();
        }
      ]
    });
    assert.equal((await handle.done).exitCode, 0);
    assert.deepEqual(await collect(handle.events), []);
    assert.equal(ctx.events[0].text, "after close");
  }
});

test("native adapter batching preserves state and malformed-line admission", async () => {
  const { createRequire } = await import("node:module"),
    native = createRequire(import.meta.url)("../dist/agent-spawn-rust.node");
  const lines = [
    JSON.stringify({ type: "thread.started", thread_id: "batched" }),
    "{",
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "after malformed" }
    })
  ];
  const state = new native.NativeSpawnAdapter("codex");
  const packets = JSON.parse(state.lines(lines));
  assert.deepEqual(
    packets.map((packet) => packet.value.event),
    ["session_start", "error", "agent_message"]
  );
  assert.equal(packets[2].value.text, "after malformed");
});

test("adapter batching retains overflowing JSON numbers as numeric host values", async () => {
  const { createRequire } = await import("node:module"),
    native = createRequire(import.meta.url)("../dist/agent-spawn-rust.node");
  const state = new native.NativeSpawnAdapter("codex"),
    raw = state.lines([
      '{"type":"turn.completed","usage":{"input_tokens":1e309,"output_tokens":0}}'
    ]);
  const packets = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(packets[0].value.inputTokens, Infinity);
});

test("queue batches retain opaque identity, order and abandon cached reads", async () => {
  const queue = new EventQueue(),
    items = Array.from({ length: 130 }, (_, index) => ({ index }));
  const waiting = queue.next();
  queue.pushMany(items);
  assert.equal((await waiting).value, items[0]);
  for (let index = 1; index < 65; index++) assert.equal((await queue.next()).value, items[index]);
  queue.abandon();
  assert.equal(queue.values.size, 0);
  assert.deepEqual(await queue.next(), { done: true, value: undefined });
});

test("batch polling observes a close or new push after a partial read", async () => {
  const queue = new EventQueue(),
    pending = queue.next();
  queue.pushMany(["one"]);
  queue.close();
  assert.equal((await pending).value, "one");
  assert.deepEqual(await queue.next(), { done: true, value: undefined });
  const live = new EventQueue(),
    first = live.next();
  live.pushMany(["first"]);
  assert.equal((await first).value, "first");
  const second = live.next();
  live.pushMany(["second"]);
  assert.equal((await second).value, "second");
  live.close();
  assert.deepEqual(await live.next(), { done: true, value: undefined });
});
