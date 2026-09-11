import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { defaults, type GrepDescriptor } from "../../../src/commands/regex-execution/protocol.js";

const grep = (pattern: string, fixed = false): GrepDescriptor => ({
  kind: "grep", patterns: [pattern], fixed, extended: true, insensitive: false, whole: false, word: false,
});
const row = (text: string) => ({ bytes: new TextEncoder().encode(text), all: false, terminated: true });

test("bounded default candidate disposal retires only its executor's endpoints", async () => {
  const provider = createBoundedRegexProvider({ maxWorkers: 2 });
  const first = new RegexExecutor(provider, { maxWorkers: 1 });
  const sibling = new RegexExecutor(provider, { maxWorkers: 1 });
  const firstSession = first.open(new AbortController().signal);
  const siblingSession = sibling.open(new AbortController().signal);
  try {
    const pending = firstSession.run(grep("^(a+)+$"), [row("a".repeat(128) + "!")]);
    const rejected = assert.rejects(pending, { code: "CLOSED" });
    const surviving = siblingSession.run(grep("a", true), [row("a".repeat(4096))]);
    await new Promise<void>(resolve => setImmediate(resolve));
    await first.dispose();
    await rejected;
    assert.deepEqual(await surviving, [[{ start: 0, end: 1 }]]);
    assert.deepEqual(await siblingSession.run(grep("b"), [row("abc")]), [[{ start: 1, end: 2 }]]);
    assert.throws(() => first.open(new AbortController().signal), { code: "CLOSED" });
  } finally {
    await Promise.all([firstSession.close(), siblingSession.close()]);
    await Promise.all([first.dispose(), sibling.dispose()]);
  }
  const reused = [provider.createWorker(defaults), provider.createWorker(defaults)];
  try { assert.throws(() => provider.createWorker(defaults), /worker count limit/); }
  finally { await Promise.all(reused.map(worker => worker.terminate())); }
});

test("bounded default candidate active deadline awaits retirement before capacity reuse", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const provider = createBoundedRegexProvider({ maxWorkers: 1 });
  const executor = new RegexExecutor(provider, { maxWorkers: 1, requestTimeoutMs: 1000 });
  const session = executor.open(new AbortController().signal);
  try {
    const pending = session.run(grep("^(a+)+$"), [row("a".repeat(128) + "!")]);
    const rejected = assert.rejects(pending, { code: "REQUEST_TIMEOUT" });
    await new Promise<void>(resolve => setImmediate(resolve));
    context.mock.timers.tick(1000);
    await rejected;
    assert.deepEqual(await session.run(grep("ok"), [row("ok")]), [[{ start: 0, end: 2 }]]);
  } finally {
    await session.close();
    await executor.dispose();
  }
  const replacement = provider.createWorker(defaults);
  await replacement.terminate();
});

test("bounded default candidate queued cancellation preserves falsey reasons and frees the queue", async () => {
  const provider = createBoundedRegexProvider({ maxWorkers: 1 });
  const executor = new RegexExecutor(provider, { maxWorkers: 1, maxQueuedRequests: 1 });
  const active = executor.open(new AbortController().signal);
  const pending = active.run(grep("^(a+)+$"), [row("a".repeat(128) + "!")]);
  const rejected = assert.rejects(pending, { code: "CLOSED" });
  try {
    for (const reason of [false, 0, null]) {
      const controller = new AbortController();
      const queued = executor.open(controller.signal);
      try {
        const waiting = queued.run(grep("ok"), [row("ok")]);
        const cancelled = assert.rejects(waiting, error => error === reason);
        controller.abort(reason);
        await cancelled;
        assert.throws(() => executor.open(controller.signal), error => error === reason);
      } finally { await queued.close(); }
    }
  } finally {
    await active.close();
    await rejected;
    await executor.dispose();
  }
  const replacement = provider.createWorker(defaults);
  await replacement.terminate();
});

test("bounded default candidate matches and exhausts work without native RegExp or Node scheduling", async context => {
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate")!;
  Object.defineProperty(globalThis, "setImmediate", { ...immediate, value: undefined });
  context.after(() => { Object.defineProperty(globalThis, "setImmediate", immediate); });
  context.mock.method(globalThis, "RegExp", () => { throw new Error("native RegExp fallback invoked"); });
  const provider = createBoundedRegexProvider({ maxWork: 512 });
  const executor = new RegexExecutor(provider);
  const session = executor.open(new AbortController().signal);
  try {
    assert.deepEqual(await session.run(grep("a|ab"), [row("zab")]), [[{ start: 1, end: 3 }]]);
    await assert.rejects(session.run(grep("^(a+)+$"), [row("a".repeat(32) + "!")]), error =>
      error instanceof Error && error.message.includes("work"));
    assert.deepEqual(await session.run(grep("a+b", true), [row("a+b")]), [[{ start: 0, end: 3 }]]);
  } finally {
    await session.close();
    await executor.dispose();
  }
});
