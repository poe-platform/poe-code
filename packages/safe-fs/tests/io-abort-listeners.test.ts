import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "vitest";
import { readBytes, type ByteSource } from "../src/contracts/io.js";

function pendingRead() {
  let resolve!: (value: IteratorResult<Uint8Array>) => void;
  let reject!: (reason: unknown) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>((done, fail) => { resolve = done; reject = fail; });
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({ next: () => pending }) };
  return { source, resolve, reject };
}

test("byte reads retire abort listeners before later reads", async () => {
  const controller = new AbortController();
  const left = pendingRead();
  const right = pendingRead();
  const a = readBytes(left.source, controller.signal).next();
  const b = readBytes(right.source, controller.signal).next();
  assert.ok(getEventListeners(controller.signal, "abort").length > 0);
  left.resolve({ done: true, value: undefined });
  await a;
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  right.resolve({ done: true, value: undefined });
  await b;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const later = pendingRead();
  const c = readBytes(later.source, controller.signal).next();
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  later.resolve({ done: true, value: undefined });
  await c;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

for (const synchronous of [false, true]) test(`byte read failure retires its listener with synchronous=${synchronous}`, async () => {
  const controller = new AbortController();
  const failure = new Error("read failed");
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({ next() {
    if (synchronous) throw failure;
    return Promise.reject(failure);
  } }) };
  await assert.rejects(readBytes(source, controller.signal).next(), error => error === failure);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

for (const fails of [false, true]) test(`byte iterator cleanup retires its listener with failure=${fails}`, async () => {
  const controller = new AbortController();
  const failure = new Error("cleanup failed");
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: Uint8Array.of(1) }),
    return: async () => { if (fails) throw failure; return { done: true, value: undefined }; },
  }) };
  const iterator = readBytes(source, controller.signal);
  await iterator.next();
  if (fails) await assert.rejects(iterator.return(undefined), error => error === failure);
  else await iterator.return(undefined);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

for (const reason of [false, 0, "", null]) test(`concurrent byte-read cancellation preserves ${String(reason)} and observes late settlement`, async () => {
  const controller = new AbortController();
  const left = pendingRead();
  const right = pendingRead();
  const results = Promise.allSettled([
    readBytes(left.source, controller.signal).next(),
    readBytes(right.source, controller.signal).next(),
  ]);
  assert.ok(getEventListeners(controller.signal, "abort").length > 0);
  controller.abort(reason);
  assert.deepEqual(await results, [
    { status: "rejected", reason },
    { status: "rejected", reason },
  ]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  left.resolve({ done: true, value: undefined });
  right.reject(new Error("late read failure"));
  await Promise.resolve();
});
