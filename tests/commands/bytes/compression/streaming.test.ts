import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { createBytePipe, type ByteSource } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { parseOptions } from "../../../../src/commands/bytes/compression/options.js";
import { stagingLimit, transform } from "../../../../src/commands/bytes/compression/stream.js";
import { binary, chunks, deferred, discard, helloMember, run, wrap } from "./helpers.js";

test("gzip-gunzip pipeline streams through bounded injected byte pipe", { timeout: 3_000 }, async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1024, signal: controller.signal });
  const source = randomBytes(1024 * 1024);
  const producer = run("gzip", [], chunks(source), { stdout: pipe.writable, signal: controller.signal });
  const close = producer.then(async (result) => { assert.equal(result.exitCode, 0, result.stderr); await pipe.close(); });
  const consumer = run("gunzip", [], pipe.readable, { signal: controller.signal });
  const [, decoded] = await Promise.all([close, consumer]);
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, source);
});

test("backpressure limits read-ahead while stdout write is blocked", { timeout: 3_000 }, async () => {
  const entered = deferred();
  const release = deferred();
  const block = randomBytes(64 * 1024);
  let produced = 0;
  let writes = 0;
  const pending = run("gzip", [], (async function* () {
    for (let index = 0; index < 80; index++) { produced++; yield block; }
  })(), {
    stdout: { async write() { writes++; entered.resolve(); await release.promise; } },
  });
  await entered.promise;
  await delay(30);
  assert.ok(produced < 12, `read ahead ${produced} chunks`);
  assert.equal(writes, 1);
  release.resolve();
  assert.equal((await pending).exitCode, 0);
  assert.equal(produced, 80);
});

test("source cancellation returns the original reason and observes late next rejection", { timeout: 3_000 }, async () => {
  const controller = new AbortController();
  const entered = deferred();
  const next = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next() { entered.resolve(); return next.promise; },
        async return() { returns++; return { value: undefined, done: true }; },
      };
    },
  };
  const reason = new Error("cancel blocked source");
  const pending = run("gzip", [], source, { signal: controller.signal });
  const rejected = assert.rejects(pending, (error) => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejected;
  next.reject(new Error("late source rejection"));
  await delay(10);
  assert.equal(returns, 1);
});

test("blocked stdout cancels promptly and late write failure stays handled", { timeout: 3_000 }, async () => {
  const controller = new AbortController();
  const entered = deferred();
  const write = deferred();
  const reason = new Error("cancel blocked sink");
  const pending = run("gunzip", [], chunks(gzipSync(randomBytes(1024 * 1024))), {
    signal: controller.signal,
    stdout: { async write() { entered.resolve(); await write.promise; } },
  });
  const rejected = assert.rejects(pending, (error) => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejected;
  write.reject(new Error("late sink rejection"));
  await delay(10);
});

test("sink error tears down a producer blocked in next and return", { timeout: 3_000 }, async () => {
  const pendingNext = deferred<IteratorResult<Uint8Array>>();
  const pendingReturn = deferred<IteratorResult<Uint8Array>>();
  let reads = 0;
  let returns = 0;
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (reads++ === 0) return { done: false, value: randomBytes(128 * 1024) };
          return pendingNext.promise;
        },
        return() { returns++; return pendingReturn.promise; },
      };
    },
  };
  const result = await run("gzip", [], source, { stdout: { async write() { throw new Error("broken consumer"); } } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /broken consumer/);
  pendingNext.reject(new Error("late next"));
  pendingReturn.reject(new Error("late return"));
  await delay(10);
  assert.equal(returns, 1);
});

test("invalid gzip input closes its source without waiting for EOF", { timeout: 3_000 }, async () => {
  const next = deferred<IteratorResult<Uint8Array>>();
  let first = true;
  let returned = false;
  let pendingRead = false;
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (first) { first = false; return { done: false, value: Buffer.from("this is not gzip") }; }
          pendingRead = true;
          return next.promise;
        },
        async return() { returned = true; return { done: true, value: undefined }; },
      };
    },
  };
  assert.equal((await run("gunzip", [], source)).exitCode, 1);
  if (pendingRead) next.reject(new Error("late invalid source"));
  await delay(10);
  assert.equal(returned, true);
});

test("producer error cancels a blocked stdout write", { timeout: 3_000 }, async () => {
  const entered = deferred();
  const sink = deferred();
  const result = await run("gunzip", [], (async function* () {
    yield gzipSync(randomBytes(64 * 1024));
    await entered.promise;
    throw new Error("producer exploded");
  })(), { stdout: { async write() { entered.resolve(); await sink.promise; } } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /producer exploded/);
  sink.reject(new Error("late sink"));
  await delay(10);
});

test("invalid byte-source chunks fail cleanly", async () => {
  const source = { async *[Symbol.asyncIterator]() { yield "not bytes"; } } as unknown as ByteSource;
  const result = await run("gzip", [], source);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Uint8Array/);
});

test("already-aborted invocation never reads or writes", async () => {
  const controller = new AbortController();
  const reason = new Error("already aborted");
  controller.abort(reason);
  await assert.rejects(run("gzip", [], { [Symbol.asyncIterator]() { assert.fail("read source"); } }, {
    signal: controller.signal, stdout: { async write() { assert.fail("write output"); } },
  }), (error) => error === reason);
});

test("file source cancellation cleans stage and retains input", { timeout: 3_000 }, async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  const controller = new AbortController();
  const entered = deferred();
  const pendingNext = deferred<IteratorResult<Uint8Array>>();
  const fs = wrap(memory, {
    readStream(_path, options) {
      assert.ok(options?.signal);
      controller.signal.addEventListener("abort", () => assert.equal(options.signal!.aborted, true), { once: true });
      return { [Symbol.asyncIterator]() { return {
        next() { entered.resolve(); return pendingNext.promise; },
        async return() { return { done: true, value: undefined }; },
      }; } };
    },
  });
  const pending = run("gzip", ["input"], undefined, { fs, signal: controller.signal });
  const rejected = assert.rejects(pending, (error) => error === controller.signal.reason);
  await entered.promise;
  controller.abort(new Error("cancel file read"));
  await rejected;
  pendingNext.reject(new Error("late file read"));
  await delay(10);
  assert.deepEqual((await memory.readdir("/")).map((entry) => entry.name), ["input"]);
  assert.deepEqual(await memory.readFile("/input"), binary);
});

for (const failure of ["cancellation", "producer error"]) {
  test(`blocked VFS consumer settles before cleanup after ${failure}`, { timeout: 3_000 }, async () => {
    const memory = createMemoryFileSystem();
    const original = randomBytes(512 * 1024);
    await memory.writeFile("/input", original);
    const controller = new AbortController();
    const entered = deferred();
    const aborted = deferred();
    const release = deferred();
    const reason = new Error(`blocked file ${failure}`);
    let active = false;
    let settled = false;
    let sourceSignal: AbortSignal | undefined;
    const fs = wrap(memory, {
      async *readStream(path, options) {
        sourceSignal = options?.signal;
        yield* memory.readStream(path, options);
        if (failure === "producer error") {
          await entered.promise;
          throw reason;
        }
      },
      async writeStream(path, source, options) {
        const signal = options?.signal;
        assert.ok(signal);
        signal.addEventListener("abort", () => aborted.resolve(), { once: true });
        active = true;
        try {
          for await (const chunk of source) {
            entered.resolve();
            if (failure === "producer error") continue;
            await release.promise;
            await memory.writeFile(path, chunk);
            signal.throwIfAborted();
          }
        } finally {
          await release.promise;
          active = false;
        }
      },
      async rm(path, options) {
        assert.equal(active, false, "cleanup raced the VFS writer");
        await memory.rm(path, options);
      },
    });
    const pending = run("gzip", ["input"], undefined, { fs, signal: controller.signal });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const checked = failure === "cancellation"
      ? assert.rejects(pending, (error) => error === reason)
      : pending.then((result) => {
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /blocked file producer error/);
      });
    await entered.promise;
    if (failure === "cancellation") controller.abort(reason);
    await aborted.promise;
    await delay(20);
    assert.equal(sourceSignal?.aborted, true);
    assert.equal(active, true);
    assert.equal(settled, false);
    assert.equal((await memory.readdir("/")).length, 2);
    release.resolve();
    await checked;
    assert.deepEqual((await memory.readdir("/")).map((entry) => entry.name), ["input"]);
    assert.ok(Buffer.from(await memory.readFile("/input")).equals(original));
  });
}

test("bounded staging counts decompressed output and rejects expansion", async () => {
  assert.equal(stagingLimit, 256 * 1024 * 1024);
  let produced = 0;
  await assert.rejects(transform(chunks(gzipSync(new Uint8Array(1024 * 1024))), async (source) => {
    for await (const chunk of source) produced += chunk.length;
  }, parseOptions("gunzip", []), new AbortController().signal, 128 * 1024), { code: "EFBIG" });
  assert.ok(produced <= 128 * 1024);
});

test("consumer returning early cannot finalize incomplete file output", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", randomBytes(512 * 1024));
  const fs = wrap(memory, { async writeStream() {} });
  const result = await run("gzip", ["input"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /complete stream/);
  assert.deepEqual((await memory.readdir("/")).map((entry) => entry.name), ["input"]);
});

test("genuine streaming emits output before input EOF", { timeout: 3_000 }, async () => {
  const written = deferred();
  const finish = deferred();
  let eof = false;
  const result = run("gzip", [], (async function* () {
    yield randomBytes(256 * 1024);
    await finish.promise;
    eof = true;
  })(), { stdout: { async write() { written.resolve(); } } });
  await written.promise;
  assert.equal(eof, false);
  finish.resolve();
  assert.equal((await result).exitCode, 0);
});

test("stdout sink has no end method and need not be closed", async () => {
  const result = await run("gzip", [], chunks(binary), { stdout: discard });
  assert.equal(result.exitCode, 0, result.stderr);
});

test("force passthrough replays empty and sliced prefix chunks exactly", async () => {
  for (const value of [new Uint8Array(), binary.subarray(5, 207), Uint8Array.of(0x1f)]) {
    const result = await run("zcat", ["-f"], chunks(new Uint8Array(), value.subarray(0, 1), new Uint8Array(), value.subarray(1)));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, Buffer.from(value));
  }
  const result = await run("zcat", ["-f"], chunks(helloMember.subarray(0, 1), helloMember.subarray(1)));
  assert.equal(result.stdout.toString(), "hello\n");
});
