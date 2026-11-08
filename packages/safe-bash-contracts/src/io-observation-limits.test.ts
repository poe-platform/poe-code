import assert from "node:assert/strict";
import { test } from "node:test";
import { createBytePipe } from "./io.js";

for (const options of [{}, { maxObservationWaiters: Infinity }]) {
  test(`allows more than 64 pending observations with ${JSON.stringify(options)}`, async () => {
    const pipe = createBytePipe(options);
    const read = pipe.endpoints!.read;
    const pending = Array.from({ length: 100 }, () => read.waitForChange(read.probe().revision, { timeoutMs: 1000 }));
    const observations = Promise.all(pending);
    await pipe.writable.write(Uint8Array.of(1));
    assert.equal((await observations).filter(value => value?.ready).length, 100);
    await pipe.abort();
  });
}

test("enforces a shared observer ceiling and releases capacity after cancellation", async () => {
  const pipe = createBytePipe({ maxObservationWaiters: 1 });
  const { read, write } = pipe.endpoints!;
  const controller = new AbortController();
  const pending = read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: controller.signal });
  await assert.rejects(write.waitForChange(write.probe().revision, { timeoutMs: 1000 }), /Too many pending/);
  const cancelled = assert.rejects(pending, /cancelled/);
  controller.abort(new Error("cancelled"));
  await cancelled;
  const next = read.waitForChange(read.probe().revision, { timeoutMs: 1000 });
  await pipe.writable.write(Uint8Array.of(1));
  assert.equal((await next)?.ready, true);
  await pipe.abort();
});

for (const maxObservationWaiters of [-1, NaN, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid observer ceiling ${maxObservationWaiters}`, () => {
    assert.throws(() => createBytePipe({ maxObservationWaiters }), /maxObservationWaiters/);
  });
}

test("a zero observer ceiling allows immediate probes but rejects pending waits", async () => {
  const pipe = createBytePipe({ maxObservationWaiters: 0 });
  const read = pipe.endpoints!.read;
  assert.equal(await read.waitForChange(read.probe().revision, { timeoutMs: 0 }), undefined);
  await assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000 }), /Too many pending/);
  await pipe.abort();
});
