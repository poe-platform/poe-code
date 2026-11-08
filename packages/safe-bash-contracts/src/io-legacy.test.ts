import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "./errors.js";
import { createBytePipe } from "./io.js";

test("legacy adapters cache identities and detached operations preserve owned bytes and backpressure", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  try {
    const readable = pipe.readable, writable = pipe.writable;
    const reader = readable[Symbol.asyncIterator]();
    assert.equal(pipe.readable, readable);
    assert.equal(pipe.writable, writable);
    assert.equal(reader, readable);
    assert.equal(readable[Symbol.asyncIterator](), reader);
    const write = writable.write, next = reader.next;
    const first = Uint8Array.of(1);
    await write(first);
    first[0] = 9;
    let accepted = false;
    const second = Uint8Array.of(2);
    const ownedWrite = writable.ownedOutput!.write;
    const pending = ownedWrite(second).then(() => { accepted = true; });
    void pending.catch(() => {});
    second[0] = 8;
    await Promise.resolve();
    assert.equal(accepted, false);
    assert.deepEqual(await next(), { done: false, value: Uint8Array.of(1) });
    await pending;
    assert.equal(accepted, true);
    await pipe.close();
    assert.deepEqual(await next(), { done: false, value: Uint8Array.of(2) });
    assert.equal((await next()).done, true);
  } finally { await pipe.abort(); }
});

test("returning an unread legacy adapter releases blocked producers", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  try {
    await pipe.writable.write(Uint8Array.of(1));
    const rejected = assert.rejects(pipe.writable.write(Uint8Array.of(2)),
      reason => reason instanceof FsError && reason.code === "EPIPE");
    void rejected.catch(() => {});
    const finish = pipe.readable[Symbol.asyncIterator]().return;
    assert.ok(finish);
    assert.equal((await finish()).done, true);
    await rejected;
    assert.equal(pipe.writable.ownedOutput!.consumerClosed.aborted, true);
  } finally { await pipe.abort(); }
});

for (const reason of [false, null, new Error("consumer failed")]) {
  test(`legacy throw rejects active reads with the exact reason ${String(reason)}`, async () => {
    const pipe = createBytePipe();
    try {
      const reader = pipe.readable[Symbol.asyncIterator]();
      const rejected = assert.rejects(reader.next(), error => Object.is(error, reason));
      void rejected.catch(() => {});
      const fail = reader.throw;
      assert.ok(fail);
      await assert.rejects(fail(reason), error => Object.is(error, reason));
      await rejected;
      assert.equal(pipe.writable.ownedOutput!.consumerClosed.reason, reason);
    } finally { await pipe.abort(); }
  });
}

test("legacy owned output allocates one consumer signal only when the getter is read", async context => {
  const NativeAbortController = AbortController;
  let allocations = 0;
  context.mock.method(globalThis, "AbortController", class extends NativeAbortController {
    constructor() { super(); allocations++; }
  });
  const pipe = createBytePipe();
  try {
    const output = pipe.writable.ownedOutput!;
    assert.equal(allocations, 0);
    const signal = output.consumerClosed;
    assert.equal(allocations, 1);
    assert.equal(output.consumerClosed, signal);
    assert.equal(allocations, 1);
    await pipe.readable[Symbol.asyncIterator]().return?.();
    assert.equal(signal.aborted, true);
    assert.equal(allocations, 1);
  } finally { await pipe.abort(); }
});
