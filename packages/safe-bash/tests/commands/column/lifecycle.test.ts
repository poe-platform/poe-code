import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type ByteSource, type InvocationCleanup, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { columnCommands } from "../../../src/commands/column/index.js";
import { Inputs } from "../../../src/commands/table-text/internal.js";
import { deferred, run } from "./helpers.js";

test("retained Buffer fragments survive reuse and producer finalization mutation", async () => {
  for (const width of [1, 2, 3, 7, 64]) {
    const original = Buffer.from("名 x\ne\u0301 y\nlong z\n");
    const reused = Buffer.alloc(width);
    const stdin: ByteSource = (async function* () {
      try {
        for (let offset = 0; offset < original.length; offset += width) {
          const size = Math.min(width, original.length - offset);
          original.copy(reused, 0, offset, offset + size);
          yield reused.subarray(0, size);
          reused.fill(0x78);
        }
      } finally { reused.fill(0x79); }
    })();
    const result = await run(["-t"], "", {}, { stdin });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "名    x\ne\u0301     y\nlong  z\n");
  }
});

test("cleanup registered synchronously before FS admission", async () => {
  const base = createMemoryFileSystem();
  await base.writeFile("/input", Buffer.from("a b\n"));
  let cleanup: InvocationCleanup | undefined;
  const fs: FileSystem = new Proxy(base, { get(target, key) {
    if (key === "stat") return (...args: Parameters<FileSystem["stat"]>) => { assert.ok(cleanup); return target.stat(...args); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(["-t", "/input"], "", {}, { fs, registerCleanup(value) { cleanup = value; } });
  assert.equal(result.exitCode, 0);
  assert.ok(cleanup);
  const first = cleanup(), second = cleanup();
  assert.equal(first, second);
  await first;
});

test("already aborted invocation admits no input and preserves errno-shaped reason", async () => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "cancel, not missing input" });
  controller.abort(reason);
  let admitted = false;
  await assert.rejects(run(["-t"], "", {}, { signal: controller.signal, stdin: { [Symbol.asyncIterator]() { admitted = true; throw new Error("unexpected"); } } }), error => error === reason);
  assert.equal(admitted, false);
});

for (const useHook of [false, true]) test(`pending source cancellation waits cooperative return; hook=${useHook}`, async () => {
  const nextStarted = deferred(), returnStarted = deferred(), releaseReturn = deferred();
  const opaqueNext = deferred<IteratorResult<Uint8Array>>();
  const controller = new AbortController(), reason = new Error("cancel input");
  let returned = 0, cleanup: InvocationCleanup | undefined;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { nextStarted.resolve(); return opaqueNext.promise; },
    async return() { returned++; returnStarted.resolve(); await releaseReturn.promise; return { done: true, value: undefined }; },
  }; } };
  const pending = run(["-t"], "", {}, { stdin, signal: controller.signal, ...(useHook ? { registerCleanup(value: InvocationCleanup) { cleanup = value; } } : {}) });
  const rejection = assert.rejects(pending, error => error === reason);
  await nextStarted.promise;
  controller.abort(reason);
  const cleanupPending = cleanup?.();
  await returnStarted.promise;
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(returned, 1);
  releaseReturn.resolve();
  await rejection;
  await cleanupPending;
  opaqueNext.reject(new Error("late next rejection must be observed"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("cleanup closes admission during a pending stat and observes late host rejection", async () => {
  const base = createMemoryFileSystem(), statStarted = deferred();
  const lateStat = deferred<Awaited<ReturnType<FileSystem["stat"]>>>();
  let cleanup: InvocationCleanup | undefined, streams = 0;
  const fs: FileSystem = new Proxy(base, { get(target, key) {
    if (key === "stat") return () => { statStarted.resolve(); return lateStat.promise; };
    if (key === "readStream") return () => { streams++; throw new Error("must not admit stream"); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const pending = run(["-t", "/slow", "/later"], "", {}, { fs, registerCleanup(value) { cleanup = value; } });
  await statStarted.promise;
  assert.ok(cleanup);
  const first = cleanup(), second = cleanup();
  assert.equal(first, second);
  await first;
  const result = await pending;
  assert.equal(result.exitCode, 1);
  assert.equal(streams, 0);
  lateStat.reject(new Error("late stat rejection"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("sink writes are awaited, owned, and sequential", async () => {
  const entered = deferred(), release = deferred();
  const received: Uint8Array[] = [];
  let calls = 0, concurrent = 0;
  const pending = run(["-t"], "a b\nlong z\n", {}, { stdout: { async write(bytes) {
    concurrent++;
    assert.equal(concurrent, 1);
    calls++;
    received.push(bytes);
    if (calls === 1) { entered.resolve(); await release.promise; }
    concurrent--;
  } } });
  await entered.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(Buffer.from(received[0]!).toString(), "a");
  release.resolve();
  assert.equal((await pending).exitCode, 0);
  assert.equal(Buffer.concat(received).toString(), "a     b\nlong  z\n");
});

test("stdout errors stop further writes and stderr errors preserve identity", async () => {
  let writes = 0;
  const result = await run(["-t"], "a b\n", {}, { stdout: { async write() { writes++; throw new FsError("EPIPE", { message: "downstream stopped" }); } } });
  assert.equal(result.exitCode, 1);
  assert.equal(writes, 1);
  assert.match(result.stderr, /downstream stopped/);
  const error = new Error("stderr failed");
  await assert.rejects(run(["--bad"], "", {}, { stderr: { async write() { throw error; } } }), failure => failure === error);
  let stderrWrites = 0;
  await assert.rejects(run(["/missing"], "", {}, { stderr: { async write() { stderrWrites++; throw error; } } }), failure => failure === error);
  assert.equal(stderrWrites, 1);
});

test("cancellation during output returns promptly and observes late sink rejection", async () => {
  const entered = deferred(), sink = deferred(), controller = new AbortController();
  const reason = new FsError("EIO", { message: "cancel output" });
  const pending = run(["-t"], "a b\n", {}, { signal: controller.signal, stdout: { write() { entered.resolve(); return sink.promise; } } });
  const rejection = assert.rejects(pending, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejection;
  sink.reject(new Error("late sink error"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("cancellation during CPU work yields cooperatively", async () => {
  const controller = new AbortController(), reason = new Error("work cancelled");
  const pending = run(["-t"], `${"a".repeat(60_000)} b\n`, {}, { signal: controller.signal });
  const rejection = assert.rejects(pending, error => error === reason);
  setImmediate(() => controller.abort(reason));
  await rejection;
});

test("primary read error survives a cleanup error", async () => {
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("primary read failure"); },
    async return(): Promise<IteratorResult<Uint8Array>> { returned++; throw new Error("secondary return failure"); },
  }; } };
  const result = await run(["-t"], "", {}, { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /primary read failure/);
  assert.doesNotMatch(result.stderr, /secondary/);
  assert.equal(returned, 1);
});

for (const mode of ["reported", "sink"] as const) test(`column settlement preserves ${mode} falsey primary identities`, async () => {
  for (const primary of [undefined, null, false, 0, 0n, "", NaN, new Error("primary")]) {
    const cleanup = new Error("secondary cleanup");
    let returns = 0, diagnostics = 0;
    const stderr: Uint8Array[] = [];
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<Uint8Array>> { throw mode === "reported" ? primary : new Error("read failure"); },
      async return(): Promise<IteratorResult<Uint8Array>> { returns++; throw cleanup; },
    }; } };
    const pending = run(["-t"], "", {}, { stdin, stderr: { async write(bytes) {
      diagnostics++;
      if (mode === "sink") throw primary;
      stderr.push(Uint8Array.from(bytes));
    } } });
    if (mode === "sink") await assert.rejects(pending, error => Object.is(error, primary));
    else {
      assert.equal((await pending).exitCode, 1);
      assert.equal(Buffer.concat(stderr).toString(), `column: ${primary instanceof Error ? primary.message : String(primary)}\n`);
    }
    assert.equal(diagnostics, 1);
    assert.equal(returns, 1);
  }
});

for (const mode of ["output", "help", "reported-open"] as const) test(`column cleanup-only failure rejects ${mode}`, async context => {
  const originalClose = Inputs.prototype.close;
  let cleanup: unknown, closes = 0;
  context.mock.method(Inputs.prototype, "close", async function(this: Inputs) {
    closes++;
    await originalClose.call(this);
    throw cleanup;
  });
  for (const reason of [undefined, null, false, 0, 0n, "", NaN, new Error("cleanup")]) {
    cleanup = reason;
    closes = 0;
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const args = mode === "help" ? ["--help"] : mode === "reported-open" ? ["/missing"] : ["-t"];
    await assert.rejects(run(args, "a b\n", {}, {
      stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
    }), error => Object.is(error, reason));
    assert.equal(closes, 1);
    if (mode === "reported-open") assert.match(Buffer.concat(stderr).toString(), /missing/);
    else assert.ok(Buffer.concat(stdout).length > 0);
  }
});

test("column late cancellation wins after awaited exactly-once cleanup", async context => {
  const originalClose = Inputs.prototype.close;
  for (const timing of ["during", "after"] as const) for (const closeFails of [false, true]) {
    const started = deferred(), release = deferred(), controller = new AbortController();
    const reason = Object.assign(new Error("late caller cancellation"), { code: "ENOENT" });
    let closes = 0, finished = false, cleanup: InvocationCleanup | undefined;
    const replacement = context.mock.method(Inputs.prototype, "close", async function(this: Inputs) {
      closes++;
      await originalClose.call(this);
      started.resolve();
      await release.promise;
      if (timing === "after") controller.abort(reason);
      if (closeFails) throw undefined;
    });
    const pending = run(["-t"], "", {}, {
      signal: controller.signal,
      registerCleanup(callback) { cleanup = callback; },
      stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw false; } }; } },
    });
    const rejection = assert.rejects(pending, error => error === reason);
    void pending.then(() => { finished = true; }, () => { finished = true; });
    try {
      await started.promise;
      assert.ok(cleanup);
      const closing = cleanup();
      assert.equal(closing, cleanup());
      const observed = Promise.resolve(closing).then(() => ({ ok: true }), error => ({ ok: false, error: error as unknown }));
      if (timing === "during") controller.abort(reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(finished, false);
      assert.equal(closes, 1);
      release.resolve();
      await rejection;
      assert.deepEqual(await observed, closeFails ? { ok: false, error: undefined } : { ok: true });
      assert.equal(closing, cleanup());
    } finally {
      release.resolve();
      await rejection;
      replacement.mock.restore();
    }
  }
});

test("actual Shell exec/dispose await column-owned VFS cooperative cleanup", async () => {
  const entered = deferred(), closing = deferred(), release = deferred();
  const opaque = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return opaque.promise; },
    async return() { returns++; closing.resolve(); await release.promise; return { done: true, value: undefined }; },
  }; } };
  const base = createMemoryFileSystem();
  await base.writeFile("/input", Buffer.from("placeholder"));
  const fs: FileSystem = new Proxy(base, { get(target, key) {
    if (key === "readStream") return () => stdin;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const instance = new Shell({ fs }).use(columnCommands());
  const execution = instance.exec("column -t /input");
  let execSettled = false, disposeSettled = false;
  void execution.then(() => { execSettled = true; }, () => { execSettled = true; });
  await entered.promise;
  const disposal = instance.dispose();
  void disposal.then(() => { disposeSettled = true; });
  await closing.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(execSettled, false);
  assert.equal(disposeSettled, false);
  assert.equal(returns, 1);
  release.resolve();
  await Promise.allSettled([execution, disposal]);
  assert.equal(execSettled, true);
  assert.equal(disposeSettled, true);
  opaque.reject(new Error("observed late next"));
  await new Promise<void>(resolve => setImmediate(resolve));
});
