import assert from "node:assert/strict";
import { test } from "vitest";
import { readBytes, type ByteSource } from "../src/contracts/io.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const reason of [false, 0, "", null]) {
  for (const done of [false, true]) test(`synchronous reads refuse producer cancellation ${String(reason)} before done=${done}`, async () => {
    const controller = new AbortController();
    const closed = gate();
    let pulls = 0;
    let closes = 0;
    const reader = readBytes({ [Symbol.asyncIterator]: () => ({
      tryNextSync(): IteratorResult<Uint8Array> {
        pulls++;
        controller.abort(reason);
        return done ? { done: true, value: undefined } : { done: false, value: Uint8Array.of(1) };
      },
      next: async () => assert.fail("cancelled synchronous source was read again"),
      async return() { closes++; closed.release(); return { done: true, value: undefined }; },
    }) }, controller.signal) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
    assert.equal(reader.tryNextSync(), undefined);
    await assert.rejects(reader.next(), error => error === reason);
    await closed.promise;
    assert.equal(pulls, 1);
    assert.equal(closes, 1);
  });
}

for (const failedRead of [false, true]) test(`closed byte readers do not replay a cleanup rejection after failedRead=${failedRead}`, async () => {
  const primary = new Error("primary");
  const cleanup = new Error("cleanup");
  let closes = 0;
  const reader = readBytes({ [Symbol.asyncIterator]: () => ({
    async next() { if (failedRead) throw primary; return { done: false, value: Uint8Array.of(1) }; },
    async return() { closes++; throw cleanup; },
  }) });
  if (failedRead) await assert.rejects(reader.next(), error => error === primary);
  else { await reader.next(); await assert.rejects(reader.return("first"), error => error === cleanup); }
  assert.deepEqual(await reader.return("later"), { done: true, value: "later" });
  assert.equal(closes, 1);
});
for (const sync of [false, true]) test(`byte reads serialize synchronous producer reentry with sync=${sync}`, async () => {
  const trace: string[] = [];
  let nested!: Promise<IteratorResult<Uint8Array>>;
  const pull = (): IteratorResult<Uint8Array> => {
    if (trace.length) { trace.push("second"); return { done: true, value: undefined }; }
    trace.push("first entered");
    nested = reader.next();
    trace.push("first returned");
    return { done: false, value: Uint8Array.of(1) };
  };
  const reader = readBytes({ [Symbol.asyncIterator]: () => ({
    ...(sync ? { tryNextSync: pull } : {}),
    next: async () => pull(),
  }) }) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
  const first = sync ? reader.tryNextSync() : await reader.next();
  assert.deepEqual(first, { done: false, value: Uint8Array.of(1) });
  await nested;
  assert.deepEqual(trace, ["first entered", "first returned", "second"]);
});

for (const sync of [false, true]) test(`byte reads preserve FIFO through iterator factory reentry with sync=${sync}`, async () => {
  const trace: string[] = [];
  let nested!: Promise<IteratorResult<Uint8Array>>;
  let pulls = 0;
  const pull = (): IteratorResult<Uint8Array> => {
    trace.push(`pull ${++pulls}`);
    return pulls === 1 ? { done: false, value: Uint8Array.of(1) } : { done: true, value: undefined };
  };
  const reader = readBytes({ [Symbol.asyncIterator]() {
    trace.push("factory entered");
    nested = reader.next();
    trace.push("factory returned");
    return { ...(sync ? { tryNextSync: pull } : {}), next: async () => pull() };
  } });
  assert.deepEqual(await reader.next(), { done: false, value: Uint8Array.of(1) });
  assert.deepEqual(await nested, { done: true, value: undefined });
  assert.deepEqual(trace, ["factory entered", "factory returned", "pull 1", "pull 2"]);
});

test("byte reads preserve FIFO when a reentrant synchronous probe declines", async () => {
  let nested!: Promise<IteratorResult<Uint8Array>>;
  let probes = 0;
  let pulls = 0;
  const reader = readBytes({ [Symbol.asyncIterator]: () => ({
    tryNextSync() {
      if (++probes === 2) nested = reader.next();
      return undefined;
    },
    async next() {
      return ++pulls === 1 ? { done: false, value: Uint8Array.of(1) } : { done: true, value: undefined };
    },
  }) }) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
  assert.equal(reader.tryNextSync(), undefined);
  assert.deepEqual(await reader.next(), { done: false, value: Uint8Array.of(1) });
  assert.deepEqual(await nested, { done: true, value: undefined });
  assert.equal(pulls, 2);
});

test("overlapping byte-reader returns both drain one cleanup and preserve their values", async () => {
  const started = gate();
  const cleanup = gate();
  let closes = 0;
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: Uint8Array.of(1) }),
    async return() { closes++; started.release(); await cleanup.promise; return { done: true, value: undefined }; },
  }) };
  const reader = readBytes(source);
  await reader.next();
  const first = reader.return("first");
  await started.promise;
  let settled = false;
  const second = reader.return("second").then(result => { settled = true; return result; });
  await Promise.resolve();
  try { assert.equal(settled, false); }
  finally { cleanup.release(); }
  assert.deepEqual(await first, { done: true, value: "first" });
  assert.deepEqual(await second, { done: true, value: "second" });
  assert.equal(closes, 1);
});

for (const reason of [false, 0, "", null]) test(`synchronous byte failure ${String(reason)} is reported after cooperative cleanup`, async () => {
  const started = gate();
  const cleanup = gate();
  let closes = 0;
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    tryNextSync() { throw reason; },
    next: async () => assert.fail("failed sync source was read again"),
    async return() { closes++; started.release(); await cleanup.promise; throw new Error("secondary cleanup failure"); },
  }) };
  const reader = readBytes(source) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
  assert.equal(reader.tryNextSync(), undefined);
  let settled = false;
  const pending = reader.next().then(() => { settled = true; assert.fail("read succeeded"); }, error => { settled = true; assert.equal(error, reason); });
  await started.promise;
  try { assert.equal(settled, false); }
  finally { cleanup.release(); }
  await pending;
  assert.equal(closes, 1);
});

test("byte-reader next calls serialize while successful synchronous reads remain synchronous", async () => {
  const entered = gate();
  const firstRead = gate();
  let pulls = 0;
  const reader = readBytes({ [Symbol.asyncIterator]: () => ({
    async next() {
      pulls++;
      if (pulls === 1) { entered.release(); await firstRead.promise; return { done: false, value: Uint8Array.of(1) }; }
      return { done: true, value: undefined };
    },
  }) });
  const first = reader.next();
  await entered.promise;
  const second = reader.next();
  try { assert.equal(pulls, 1); }
  finally { firstRead.release(); }
  assert.deepEqual(await first, { done: false, value: Uint8Array.of(1) });
  assert.deepEqual(await second, { done: true, value: undefined });
  let syncPulls = 0;
  const fast = readBytes({ [Symbol.asyncIterator]: () => ({
    tryNextSync() { return ++syncPulls === 1 ? { done: false, value: Uint8Array.of(2) } : { done: true, value: undefined }; },
    next: async () => assert.fail("synchronous read took asynchronous source path"),
  }) }) as AsyncGenerator<Uint8Array> & { tryNextSync(): IteratorResult<Uint8Array> | undefined };
  assert.deepEqual(fast.tryNextSync(), { done: false, value: Uint8Array.of(2) });
  assert.deepEqual(fast.tryNextSync(), { done: true, value: undefined });
});

test("a reentrant return waits for the active producer read before closing it", async () => {
  const entered = gate();
  const pendingRead = gate();
  let closing!: Promise<IteratorResult<Uint8Array>>;
  let closes = 0;
  const reader = readBytes({ [Symbol.asyncIterator]: () => ({
    async next() {
      closing = reader.return("closed");
      entered.release();
      await pendingRead.promise;
      return { done: false, value: Uint8Array.of(1) };
    },
    async return() { closes++; return { done: true, value: undefined }; },
  }) });
  const reading = reader.next();
  await entered.promise;
  try { assert.equal(closes, 0); }
  finally { pendingRead.release(); }
  assert.deepEqual(await reading, { done: false, value: Uint8Array.of(1) });
  assert.deepEqual(await closing, { done: true, value: "closed" });
  assert.equal(closes, 1);
});
