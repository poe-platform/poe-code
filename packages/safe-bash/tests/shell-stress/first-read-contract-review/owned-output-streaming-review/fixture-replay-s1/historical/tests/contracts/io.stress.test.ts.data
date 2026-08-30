import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  collectBytes, collectText, createBytePipe, isFsError, pipeBytes, toByteSource,
  type ByteSource,
} from "../../src/contracts/index.js";

async function within<T>(promise: Promise<T>): Promise<T> {
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(500, undefined, { signal: controller.signal }).then(() => {
        throw new Error("operation did not settle promptly");
      }),
    ]);
  } finally {
    controller.abort();
  }
}

test("abort remains observable after producer close while bytes are unread", async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ signal: controller.signal });
  await pipe.writable.write(new Uint8Array([1]));
  await pipe.close();
  await setImmediate();
  const reason = new Error("consumer canceled");
  controller.abort(reason);
  await assert.rejects(collectBytes(pipe.readable, { maxBytes: 1 }), (error) => error === reason);
});

test("aborting a fully drained pipe does not undo successful closure", async () => {
  const pipe = createBytePipe();
  await pipe.close();
  assert.equal(await collectText(pipe.readable, { maxBytes: 0 }), "");
  await pipe.abort(new Error("too late"));
  await pipe.close();
});

test("abort preserves the first failure and releases blocked writes and close", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  await pipe.writable.write(new Uint8Array([1]));
  const pendingWrite = pipe.writable.write(new Uint8Array([2]));
  const pendingClose = pipe.close();
  const reason = new Error("first");
  const writeRejected = assert.rejects(pendingWrite, (error) => error === reason);
  const closeRejected = assert.rejects(pendingClose, (error) => error === reason);
  await pipe.abort(reason);
  await pipe.abort(new Error("second"));
  await within(Promise.all([writeRejected, closeRejected]));
  await assert.rejects(collectBytes(pipe.readable, { maxBytes: 2 }), (error) => error === reason);
});

test("a thrown producer can fail the pipe without dangling internal rejections", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  const reason = new Error("producer failed");
  const source = (async function* () {
    yield new Uint8Array([1]);
    throw reason;
  })();
  const producer = (async () => {
    try {
      await pipeBytes(source, pipe.writable);
      await pipe.close();
    } catch (error) {
      await pipe.abort(error);
      throw error;
    }
  })();
  const result = await within(Promise.allSettled([
    producer, collectBytes(pipe.readable, { maxBytes: 10 }),
  ]));
  assert.deepEqual(result.map((entry) => entry.status === "rejected" ? entry.reason : null),
    [reason, reason]);
  await setImmediate();
});

test("concurrent pipe writes preserve invocation order and snapshot mutable chunks", async () => {
  const pipe = createBytePipe({ highWaterMark: 3 });
  const reading = collectBytes(pipe.readable, { maxBytes: 128 });
  const buffer = Buffer.alloc(1);
  const writes: Promise<void>[] = [];
  for (let value = 0; value < 128; value++) {
    buffer[0] = value;
    writes.push(pipe.writable.write(buffer));
  }
  await Promise.all(writes);
  await pipe.close();
  assert.deepEqual(await reading, Uint8Array.from({ length: 128 }, (_value, index) => index));
});

test("an oversized individual chunk still flows through a small watermark", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  const input = new Uint8Array(128 * 1024).fill(231);
  const reading = collectBytes(pipe.readable, { maxBytes: input.byteLength });
  await pipe.writable.write(input);
  await pipe.close();
  assert.deepEqual(await reading, input);
});

test("return and throw cancel consumers even before the first read", async () => {
  for (const action of ["return", "throw"] as const) {
    const pipe = createBytePipe({ highWaterMark: 1 });
    await pipe.writable.write(new Uint8Array([1]));
    const reason = new Error("reader threw");
    const pending = assert.rejects(pipe.writable.write(new Uint8Array([2])),
      (error) => action === "return" ? isFsError(error, "EPIPE") : error === reason);
    const reader = pipe.readable[Symbol.asyncIterator]();
    if (action === "return") await reader.return?.();
    else await assert.rejects(reader.throw!(reason), (error) => error === reason);
    await within(pending);
  }
});

test("collectBytes cancels a stalled next and does not await uncooperative cleanup", async () => {
  const controller = new AbortController();
  let returns = 0;
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return: () => { returns++; return new Promise(() => {}); },
      };
    },
  };
  const reason = new Error("abort stalled input");
  const collecting = collectBytes(source, { maxBytes: 1, signal: controller.signal });
  await setImmediate();
  const rejected = assert.rejects(collecting, (error) => error === reason);
  controller.abort(reason);
  await within(rejected);
  assert.equal(returns, 1);
});

test("pipeBytes aborts a stalled sink and observes late write and cleanup failures", async () => {
  const controller = new AbortController();
  let rejectWrite: (error: unknown) => void = () => {};
  let returns = 0;
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: false, value: new Uint8Array([1]) }),
        return: async () => { returns++; throw new Error("late cleanup failure"); },
      };
    },
  };
  const copying = pipeBytes(source, {
    write: () => new Promise((_resolve, reject) => { rejectWrite = reject; }),
  }, controller.signal);
  await setImmediate();
  const reason = new Error("abort stalled sink");
  const rejected = assert.rejects(copying, (error) => error === reason);
  controller.abort(reason);
  await within(rejected);
  rejectWrite(new Error("late sink failure"));
  await setImmediate();
  assert.equal(returns, 1);
});

test("invalid runtime byte inputs are rejected instead of coerced", async () => {
  assert.throws(() => toByteSource(3 as unknown as Uint8Array), TypeError);
  let written = false;
  const invalid = (async function* () { yield "not bytes"; })() as unknown as ByteSource;
  await assert.rejects(pipeBytes(invalid, { async write() { written = true; } }), TypeError);
  assert.equal(written, false);
});

test("hundreds of empty, closed, and abandoned pipes settle without background errors", async () => {
  await Promise.all(Array.from({ length: 200 }, async (_value, index) => {
    const pipe = createBytePipe();
    if (index % 2 === 0) {
      await pipe.close();
      assert.equal(await collectText(pipe.readable, { maxBytes: 0 }), "");
    } else {
      await pipe.abort();
      await assert.rejects(collectBytes(pipe.readable, { maxBytes: 0 }),
        (error) => isFsError(error, "EPIPE"));
    }
  }));
  await setImmediate();
});

test("successful and canceled stream helpers release their AbortSignal listeners", async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ signal: controller.signal });
  const reading = collectBytes(pipe.readable, { maxBytes: 1, signal: controller.signal });
  await pipeBytes(toByteSource(new Uint8Array([1])), pipe.writable, controller.signal);
  await pipe.close();
  await reading;
  await setImmediate();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const canceled = createBytePipe({ signal: controller.signal });
  await canceled.abort();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("an aborted pending input can reject later without an unhandled rejection", async () => {
  let rejectRead: (error: unknown) => void = () => {};
  const controller = new AbortController();
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((_resolve, reject) => { rejectRead = reject; }),
        return: async () => { throw new Error("cleanup rejected"); },
      };
    },
  };
  const collecting = collectBytes(source, { maxBytes: 0, signal: controller.signal });
  const reason = new Error("cancel read");
  const rejected = assert.rejects(collecting, (error) => error === reason);
  await setImmediate();
  controller.abort(reason);
  await within(rejected);
  rejectRead(new Error("late read failure"));
  await setImmediate();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("byte limits preserve the primary error when iterator cleanup also fails", async () => {
  const source: ByteSource = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: false, value: new Uint8Array([1]) }),
        return: async () => { throw new Error("cleanup failure"); },
      };
    },
  };
  await assert.rejects(collectBytes(source, { maxBytes: 0 }), (error) => isFsError(error, "EFBIG"));
});
