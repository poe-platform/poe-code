import assert from "node:assert/strict";
import { test } from "node:test";
import { createBufferedOutput } from "./io.js";

test("empty buffered output does not write to an already closed consumer", async () => {
  const consumer = new AbortController();
  const reason = new Error("consumer finished");
  consumer.abort(reason);
  const sink = { async write() { assert.fail("empty output reached the sink"); } };
  const output = createBufferedOutput({ ...sink, ownedOutput: { ...sink, consumerClosed: consumer.signal } }, new AbortController().signal);
  await output.write(new Uint8Array());
  await output.flush();
  await assert.rejects(output.write(Uint8Array.of(1)), error => error === reason);
});

test("buffered output coalesces small writes and owns borrowed bytes", async () => {
  const chunks: Uint8Array[] = [];
  const output = createBufferedOutput({ async write(bytes) { chunks.push(bytes.slice()); } }, new AbortController().signal, 4);
  const borrowed = Uint8Array.of(1, 2);
  await output.write(borrowed);
  borrowed.fill(9);
  await output.write(Uint8Array.of(3, 4, 5));
  await output.flush();
  await output.flush();
  assert.deepEqual(chunks, [Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5)]);
});

test("buffered output propagates backpressure, failures and cancellation", async () => {
  const controller = new AbortController();
  const failure = new Error("sink failed");
  let release!: () => void;
  const output = createBufferedOutput({ async write() { await new Promise<void>(resolve => { release = resolve; }); throw failure; } }, controller.signal, 2);
  let settled = false;
  const writing = output.write(Uint8Array.of(1, 2));
  void writing.catch(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await assert.rejects(writing, error => error === failure);
  await assert.rejects(output.flush(), error => error === failure);
  controller.abort(false);
  await assert.rejects(output.write(Uint8Array.of(3)), error => error === false);
});
