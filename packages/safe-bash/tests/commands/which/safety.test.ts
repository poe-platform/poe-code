import assert from "node:assert/strict";
import test from "node:test";
import { createWhichCommand } from "../../../src/commands/which/index.js";
import { FsError } from "../../../src/contracts/index.js";
import { context, controlled, deferred, file, rejectsExactly, run } from "./helpers.js";

test("preaborted exact reasons precede every validation and provider operation", async () => {
  for (const reason of [new Error("abort"), new FsError("ENOENT"), { code: "EACCES" }, "stop", 0, false, null]) {
    const controller = new AbortController();
    controller.abort(reason);
    const { fs, calls } = controlled();
    await rejectsExactly(() => run(["\0"], {}, { fs, signal: controller.signal }), reason);
    assert.deepEqual(calls, []);
  }
  const signal = new Proxy(new AbortController().signal, {
    get(target, key) {
      if (key === "throwIfAborted") return () => { throw undefined; };
      return Reflect.get(target, key, target);
    },
  });
  await rejectsExactly(() => run([], {}, { signal }), undefined);
});

test("bounded scan cancellation checkpoints interrupt long inputs before providers", async () => {
  const reason = { stop: "scan" };
  const { fs, calls } = controlled();
  let checks = 0;
  const signal = new Proxy(new AbortController().signal, {
    get(target, key) {
      if (key === "throwIfAborted") return () => { if (++checks === 8) throw reason; };
      return Reflect.get(target, key, target);
    },
  });
  await rejectsExactly(() => run(["a".repeat(16000)], {}, { fs, signal }), reason);
  assert.deepEqual(calls, []);
});

test("abort after stat success/failure wins and prevents access", async () => {
  for (const shouldThrow of [false, true]) for (const reason of [null, false, { code: "ENOENT" }]) {
    const controller = new AbortController();
    const { fs, calls } = controlled({ async stat(path, options) {
      assert.equal(path, "/a/p");
      assert.equal(options?.signal, controller.signal);
      controller.abort(reason);
      if (shouldThrow) throw new FsError("ENOENT");
      return file;
    } });
    await rejectsExactly(() => run(["p"], {}, { fs, signal: controller.signal }), reason);
    assert.deepEqual(calls, []);
  }
});

test("abort after access success/failure wins and prevents output", async () => {
  for (const shouldThrow of [false, true]) {
    const controller = new AbortController();
    const reason = new FsError("EACCES");
    const { fs, calls } = controlled({ async access(path, mode, options) {
      assert.equal(path, "/a/p");
      assert.equal(mode, 1);
      assert.equal(options?.signal, controller.signal);
      controller.abort(reason);
      if (shouldThrow) throw new FsError("ENOTSUP");
    } });
    const capture = context(["-a", "p"], { fs, signal: controller.signal });
    await rejectsExactly(() => createWhichCommand().execute(capture.invocation), reason);
    assert.deepEqual(capture.stdout, []);
    assert.deepEqual(capture.stderr, []);
    assert.deepEqual(calls, ["stat /a/p"]);
  }
});

test("cooperative provider teardown is awaited; opaque metadata is not forcibly preempted", async () => {
  const controller = new AbortController();
  const admitted = deferred<void>();
  const release = deferred<void>();
  let settled = false;
  let cleaned = false;
  const reason = { stop: "provider" };
  const { fs } = controlled({ async stat(path, options) {
    assert.equal(options?.signal, controller.signal);
    admitted.resolve();
    try { await release.promise; options?.signal?.throwIfAborted(); return file; }
    finally { cleaned = true; }
  } });
  const operation = rejectsExactly(() => run(["p"], {}, { fs, signal: controller.signal }), reason).then(() => { settled = true; });
  await admitted.promise;
  controller.abort(reason);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(cleaned, false);
  release.resolve();
  await operation;
  assert.equal(cleaned, true);
});

test("stdout/stderr sync and async sink failures retain identity without retries or diagnostics", async () => {
  for (const destination of ["stdout", "stderr"] as const) for (const synchronous of [true, false]) {
    for (const reason of [new FsError("ENOENT"), { code: "EACCES" }, null, undefined, false, "sink"]) {
      let writes = 0;
      const sink = { write() { writes++; if (synchronous) throw reason; return Promise.reject(reason); } };
      const { fs, calls } = controlled();
      const capture = context(destination === "stdout" ? ["-a", "p"] : [], { fs, [destination]: sink });
      await rejectsExactly(() => createWhichCommand().execute(capture.invocation), reason);
      assert.equal(writes, 1);
      assert.deepEqual(capture.stderr, []);
      assert.equal(calls.length, destination === "stdout" ? 2 : 0);
    }
  }
});

test("abort during sink completion wins over sink failure and stops further work", async () => {
  for (const destination of ["stdout", "stderr"] as const) {
    const controller = new AbortController();
    const reason = { stop: "sink" };
    const { fs } = controlled();
    await rejectsExactly(() => run(destination === "stdout" ? ["p"] : [], {}, {
      fs, signal: controller.signal,
      [destination]: { async write() { controller.abort(reason); throw new Error("secondary"); } },
    }), reason);
  }
});

test("backpressure serializes probes and each retained output chunk owns stable bytes", async () => {
  const { fs, calls } = controlled();
  const entered = deferred<void>();
  const release = deferred<void>();
  const chunks: Uint8Array[] = [];
  const operation = run(["-a", "p"], {}, { fs, stdout: { async write(bytes) {
    chunks.push(bytes);
    if (chunks.length === 1) { entered.resolve(); await release.promise; }
  } } });
  await entered.promise;
  assert.deepEqual(calls, ["stat /a/p", "access /a/p"]);
  assert.equal(Buffer.from(chunks[0]!).toString(), "/a/p\n");
  release.resolve();
  assert.equal((await operation).exitCode, 0);
  assert.equal(chunks.length, 2);
  assert.notEqual(chunks[0]?.buffer, chunks[1]?.buffer);
  assert.equal(Buffer.from(chunks[0]!).toString(), "/a/p\n");
  assert.equal(Buffer.from(chunks[1]!).toString(), "/b/p\n");
});

test("aborted pending sink has its late rejection observed, with no additional writes", async () => {
  const controller = new AbortController();
  const entered = deferred<void>();
  const release = deferred<void>();
  const reason = { stop: "pending-sink" };
  let writes = 0;
  const { fs, calls } = controlled();
  const operation = rejectsExactly(() => run(["-a", "p"], {}, { fs, signal: controller.signal, stdout: {
    async write() { writes++; entered.resolve(); await release.promise; },
  } }), reason);
  await entered.promise;
  controller.abort(reason);
  await operation;
  release.reject(new Error("observed late rejection"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.deepEqual(calls, ["stat /a/p", "access /a/p"]);
});

test("borrowed input, capabilities, mode and output ownership are never inspected", async () => {
  const { fs } = controlled();
  Object.defineProperty(fs, "capabilities", { get() { throw new Error("capabilities read"); } });
  assert.equal((await run(["p", "-"], {}, { fs })).exitCode, 0);
});
