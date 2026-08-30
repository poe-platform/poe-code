import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  collectBytes, collectText, createBytePipe, isFsError, pipeBytes, toByteSource, writeText,
  type ByteSink, type ByteSource,
} from "../../src/contracts/index.js";

test("byte sources preserve binary bytes and UTF-8 text", async () => {
  assert.deepEqual(await collectBytes(toByteSource(new Uint8Array([0, 128, 255])), { maxBytes: 3 }),
    new Uint8Array([0, 128, 255]));
  assert.equal(await collectText(toByteSource("hello 🌍"), { maxBytes: 10 }), "hello 🌍");
  assert.equal(await collectText(toByteSource(""), { maxBytes: 0 }), "");
});

test("byte sources snapshot Uint8Array and Buffer inputs at creation", async () => {
  for (const input of [new Uint8Array([1, 2]), Buffer.from([1, 2])]) {
    const source = toByteSource(input);
    input[0] = 9;
    assert.deepEqual(await collectBytes(source, { maxBytes: 2 }), new Uint8Array([1, 2]));
  }
});

test("collectors enforce explicit byte limits and close overflowing sources", async () => {
  let finalized = false;
  const source = (async function* () {
    try {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    } finally {
      finalized = true;
    }
  })();
  await assert.rejects(collectBytes(source, { maxBytes: 2 }), (error) => isFsError(error, "EFBIG"));
  assert.equal(finalized, true);
  for (const maxBytes of [-1, 0.5, Infinity, NaN]) {
    await assert.rejects(collectBytes(toByteSource(""), { maxBytes }), RangeError);
  }
});

test("collectors copy reused buffers and decode UTF-8 split across chunks", async () => {
  const bytes = Buffer.from([1]);
  const reused = (async function* () {
    yield bytes;
    bytes[0] = 2;
    yield bytes;
  })();
  assert.deepEqual(await collectBytes(reused, { maxBytes: 2 }), new Uint8Array([1, 2]));
  const encoded = new TextEncoder().encode("🌍");
  const split = (async function* () {
    yield encoded.subarray(0, 2);
    yield encoded.subarray(2);
  })();
  assert.equal(await collectText(split, { maxBytes: 4 }), "🌍");
});

test("collectors reject pre-aborted operations", async () => {
  const reason = new Error("stop");
  await assert.rejects(collectBytes(toByteSource("input"), {
    maxBytes: 5, signal: AbortSignal.abort(reason),
  }), (error) => error === reason);
});

test("pipes stream while the producer runs and apply byte-based backpressure", { timeout: 2_000 }, async () => {
  const pipe = createBytePipe({ highWaterMark: 2 });
  await pipe.writable.write(new Uint8Array([1, 2]));
  let secondWriteFinished = false;
  const secondWrite = pipe.writable.write(new Uint8Array([3])).then(() => {
    secondWriteFinished = true;
  });
  await setImmediate();
  assert.equal(secondWriteFinished, false);
  const reader = pipe.readable[Symbol.asyncIterator]();
  assert.deepEqual((await reader.next()).value, new Uint8Array([1, 2]));
  await secondWrite;
  assert.equal(secondWriteFinished, true);
  await pipe.close();
  assert.deepEqual((await reader.next()).value, new Uint8Array([3]));
  assert.equal((await reader.next()).done, true);
});

test("pipe writes take ownership through byte copies, including Buffer inputs", async () => {
  const pipe = createBytePipe();
  const input = Buffer.from([1]);
  await pipe.writable.write(input);
  input[0] = 2;
  await pipe.close();
  assert.deepEqual(await collectBytes(pipe.readable, { maxBytes: 1 }), new Uint8Array([1]));
});

test("pipe cancellation rejects blocked producers and readers", { timeout: 2_000 }, async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: controller.signal });
  await pipe.writable.write(new Uint8Array([1]));
  const pendingWrite = pipe.writable.write(new Uint8Array([2]));
  const reason = new Error("cancel pipeline");
  const rejectedWrite = assert.rejects(pendingWrite, (error) => error === reason);
  controller.abort(reason);
  await rejectedWrite;
  await assert.rejects(collectBytes(pipe.readable, { maxBytes: 2 }), (error) => error === reason);
});

test("breaking consumption produces EPIPE for pending writers", { timeout: 2_000 }, async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  const producer = (async () => {
    for (const byte of [1, 2, 3, 4]) await pipe.writable.write(new Uint8Array([byte]));
    await pipe.close();
  })();
  const rejected = assert.rejects(producer, (error) => isFsError(error, "EPIPE"));
  for await (const chunk of pipe.readable) {
    assert.equal(chunk[0], 1);
    break;
  }
  await rejected;
});

test("returning an unread pipe releases blocked producers", { timeout: 2_000 }, async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  await pipe.writable.write(new Uint8Array([1]));
  const rejected = assert.rejects(pipe.writable.write(new Uint8Array([2])),
    (error) => isFsError(error, "EPIPE"));
  await pipe.readable[Symbol.asyncIterator]().return?.();
  await rejected;
});

test("closed and pre-aborted pipes reject further writes", async () => {
  const pipe = createBytePipe();
  await pipe.close();
  await pipe.close();
  await assert.rejects(pipe.writable.write(new Uint8Array([1])), (error) => isFsError(error, "EPIPE"));
  assert.equal(await collectText(pipe.readable, { maxBytes: 0 }), "");
  const reason = new Error("already canceled");
  const aborted = createBytePipe({ signal: AbortSignal.abort(reason) });
  await assert.rejects(aborted.writable.write(new Uint8Array([1])), (error) => error === reason);
  await assert.rejects(aborted.close(), (error) => error === reason);
});

test("pipe watermarks must be positive finite safe integers", () => {
  for (const highWaterMark of [0, -1, 0.5, Infinity, NaN]) {
    assert.throws(() => createBytePipe({ highWaterMark }), RangeError);
  }
});

test("pipeBytes awaits sink acceptance before requesting the next chunk", async () => {
  const events: string[] = [];
  const source: ByteSource = (async function* () {
    events.push("first");
    yield new Uint8Array([1]);
    events.push("second");
    yield new Uint8Array([2]);
  })();
  const sink: ByteSink = {
    async write(chunk) {
      events.push(`write:${chunk[0]}`);
      await Promise.resolve();
      events.push(`accepted:${chunk[0]}`);
    },
  };
  await pipeBytes(source, sink);
  assert.deepEqual(events, ["first", "write:1", "accepted:1", "second", "write:2", "accepted:2"]);
});

test("writeText encodes UTF-8 and propagates sink failures", async () => {
  const chunks: Uint8Array[] = [];
  await writeText({ async write(chunk) { chunks.push(chunk); } }, "é");
  assert.deepEqual(chunks, [new Uint8Array([195, 169])]);
  const failure = new Error("write failed");
  await assert.rejects(writeText({ async write() { throw failure; } }, "text"),
    (error) => error === failure);
});
