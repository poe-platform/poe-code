import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentOutput, documentByteSink, documentByteSource } from "../../../src/commands/docx/io.js";
import { collectBytes, toByteSource, type ByteSource } from "../../../src/contracts/io.js";
import type { InvocationCleanup } from "../../../src/contracts/command.js";

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test("document byte adapters acquire nothing during construction", async () => {
  let reads = 0;
  let writes = 0;
  const source = documentByteSource({ [Symbol.asyncIterator]() { reads++; return toByteSource("ready")[Symbol.asyncIterator](); } });
  const sink = documentByteSink({ async write() { writes++; } });
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  const signal = new AbortController().signal;
  assert.deepEqual(await collectBytes(source.open(signal), { maxBytes: 16 }), new TextEncoder().encode("ready"));
  await sink.write(new Uint8Array([1]), signal);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
});

test("document source preserves producer reuse until the consumer takes its owned copy", async () => {
  const reused = Buffer.from([4, 5]);
  const source = documentByteSource((async function* () {
    try { yield reused; reused.set([6, 7]); yield reused; }
    finally { reused.fill(0); }
  })());
  assert.deepEqual(await collectBytes(source.open(new AbortController().signal), { maxBytes: 4 }), new Uint8Array([4, 5, 6, 7]));
  assert.deepEqual(reused, Buffer.from([0, 0]));
});

test("document source preserves errors and awaits early consumer cleanup", async () => {
  const failure = new Error("source unavailable");
  const failed = documentByteSource({ [Symbol.asyncIterator]() { return { next: async () => { throw failure; } }; } });
  await assert.rejects(collectBytes(failed.open(new AbortController().signal), { maxBytes: 8 }), error => error === failure);
  let closed = false;
  const source = documentByteSource((async function* () {
    try { yield new Uint8Array([1]); yield new Uint8Array([2]); }
    finally { await Promise.resolve(); closed = true; }
  })());
  for await (const chunk of source.open(new AbortController().signal)) { assert.equal(chunk[0], 1); break; }
  assert.equal(closed, true);
});

test("document adapters reject an already aborted signal before acquiring resources", async () => {
  const controller = new AbortController();
  const reason = { phase: "before acquisition" };
  controller.abort(reason);
  const source = documentByteSource({ [Symbol.asyncIterator]() { assert.fail("source acquired"); } });
  const sink = documentByteSink({ async write() { assert.fail("sink acquired"); } });
  await assert.rejects(collectBytes(source.open(controller.signal), { maxBytes: 8 }), error => error === reason);
  await assert.rejects(sink.write(new Uint8Array([1]), controller.signal), error => error === reason);
});

test("document sink awaits backpressure and preserves write failure", async () => {
  const started = deferred<void>();
  const gate = deferred<void>();
  const signal = new AbortController().signal;
  const bytes = new Uint8Array([9, 8]);
  let completed = false;
  const sink = documentByteSink({ async write(chunk) { assert.equal(chunk, bytes); started.resolve(); await gate.promise; } });
  const pending = sink.write(bytes, signal).then(() => { completed = true; });
  await started.promise;
  assert.equal(completed, false);
  gate.resolve();
  await pending;
  assert.equal(completed, true);
  const reason = new Error("sink unavailable");
  await assert.rejects(documentByteSink({ async write() { throw reason; } }).write(bytes, signal), error => error === reason);
});

test("document sink cancellation retains borrowed reason and observes late rejection", async () => {
  const controller = new AbortController();
  const started = deferred<void>();
  const gate = deferred<void>();
  const sink = documentByteSink({ async write() { started.resolve(); await gate.promise; } });
  const pending = sink.write(new Uint8Array([1]), controller.signal);
  await started.promise;
  const reason = { phase: "write" };
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  gate.reject(new Error("late sink failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("document source cancellation finalizes iteration and observes late rejection", async () => {
  const controller = new AbortController();
  const started = deferred<void>();
  const gate = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { started.resolve(); return gate.promise; },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const pending = collectBytes(documentByteSource(input).open(controller.signal), { maxBytes: 8 });
  await started.promise;
  const reason = { phase: "read" };
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(returns, 1);
  gate.reject(new Error("late source failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("document adapter cancellation leaves sibling streams usable", async () => {
  const first = new AbortController();
  const sibling = new AbortController();
  const reason = new Error("first stopped");
  first.abort(reason);
  const output: number[] = [];
  const sink = documentByteSink({ async write(chunk) { output.push(...chunk); } });
  await assert.rejects(sink.write(new Uint8Array([1]), first.signal), error => error === reason);
  await sink.write(new Uint8Array([2]), sibling.signal);
  assert.deepEqual(output, [2]);
  assert.equal(sibling.signal.aborted, false);
});

test("document output registers cleanup before admission and drains owned writes", async () => {
  const controller = new AbortController();
  const consumer = new AbortController();
  const gate = deferred<void>();
  const started = deferred<void>();
  let registered: InvocationCleanup | undefined;
  const output = createDocumentOutput({ signal: controller.signal, registerCleanup(cleanup) { registered = cleanup; } }, {
    async write() { assert.fail("owned output must enroll the destination capability"); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { assert.equal(typeof registered, "function"); started.resolve(); await gate.promise; } },
  });
  assert.equal(output.cleanup, registered);
  const pending = output.sink.write(new Uint8Array([1]), controller.signal);
  await started.promise;
  const reason = new Error("consumer finished");
  consumer.abort(reason);
  await assert.rejects(pending, error => error === reason);
  let drained = false;
  const cleanup = output.cleanup();
  assert.equal(cleanup, output.cleanup());
  void cleanup.then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  await assert.rejects(output.sink.write(new Uint8Array([2]), controller.signal), error => error === reason);
  gate.resolve();
  await cleanup;
  assert.equal(drained, true);
  assert.equal(controller.signal.aborted, false);
});

test("document output cleanup closes direct contexts without aborting sibling destinations", async () => {
  const signal = new AbortController().signal;
  const chunks: number[] = [];
  const first = createDocumentOutput({ signal }, { async write(chunk) { chunks.push(...chunk); } });
  const sibling = createDocumentOutput({ signal }, { async write(chunk) { chunks.push(...chunk); } });
  try {
    await first.sink.write(new Uint8Array([1]), signal);
    await first.cleanup();
    await assert.rejects(first.sink.write(new Uint8Array([2]), signal), /closed/);
    await sibling.sink.write(new Uint8Array([3]), signal);
    assert.deepEqual(chunks, [1, 3]);
    assert.equal(signal.aborted, false);
  } finally {
    await Promise.all([first.cleanup(), sibling.cleanup()]);
  }
});

test("document output honors cleanup invoked synchronously during registration", async () => {
  const signal = new AbortController().signal;
  let cleanup!: Promise<void>;
  const output = createDocumentOutput({ signal, registerCleanup(close) { cleanup = Promise.resolve(close()); } }, {
    async write() { assert.fail("closed output admitted a write"); },
  });
  await assert.rejects(output.sink.write(new Uint8Array([1]), signal), /closed/);
  await cleanup;
  assert.equal(output.cleanup(), cleanup);
});
