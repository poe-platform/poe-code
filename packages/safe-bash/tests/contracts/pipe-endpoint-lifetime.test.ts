import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createBytePipe, outputFailure, type BytePipe } from "../../src/contracts/io.js";
import { FsError } from "../../src/contracts/errors.js";

for (const direction of ["read", "write"] as const) for (const buffered of [false, true]) for (const peerState of [0, 1, 2, 3]) {
  test(`pipe endpoint static topology: ${direction}, buffered=${buffered}, peer=${peerState}`, async context => {
    const pipe = createBytePipe();
    context.after(() => pipe.abort());
    assert.ok(pipe.endpoints);
    const endpoint = pipe.endpoints[direction];
    const peer = pipe.endpoints[direction === "read" ? "write" : "read"];
    if (buffered) await pipe.endpoints.write.writable.write(Uint8Array.of(88, 10));
    const alias = peerState >= 2 ? peer.acquire() : undefined;
    if (peerState !== 0) await peer.close();
    if (peerState === 3) await alias!.close();
    const peerClosed = peerState === 1 || peerState === 3;
    const observation = endpoint.probe();
    assert.equal(observation.peerClosed, peerClosed);
    assert.equal(observation.ready, direction === "read" ? buffered || peerClosed : peerClosed);
    assert.equal(typeof observation.revision, "bigint");
    assert.deepEqual(endpoint.probe(), observation);
    if (alias) await alias.close();
  });
}

test("endpoint aliases close independently, idempotently, and cannot be resurrected", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const readerAlias = read.acquire();
  const writerAlias = write.acquire();
  assert.notEqual(readerAlias, read);
  assert.notEqual(writerAlias, write);
  const readerClosing = read.close();
  assert.equal(readerClosing, read.close());
  await readerClosing;
  await write.close();
  assert.equal(writerAlias.probe().peerClosed, false);
  assert.equal(readerAlias.probe().peerClosed, false);
  assert.throws(() => read.acquire(), { code: "EBADF" });
  assert.throws(() => write.acquire(), { code: "EBADF" });
  await writerAlias.writable.write(Uint8Array.of(97));
  await writerAlias.close();
  assert.equal(readerAlias.probe().peerClosed, true);
  const borrowed = readerAlias.readable[Symbol.asyncIterator]();
  assert.deepEqual(await borrowed.next(), { done: false, value: Uint8Array.of(97) });
  assert.equal((await borrowed.next()).done, true);
  await readerAlias.close();
});

test("returning a pending read borrow releases the operation, not an endpoint reference or future bytes", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const borrowed = read.readable[Symbol.asyncIterator]();
  const pending = borrowed.next();
  await borrowed.return?.();
  assert.equal((await pending).done, true);
  assert.equal(write.probe().peerClosed, false);
  assert.equal(write.writable.ownedOutput?.consumerClosed.aborted, false);
  const replacement = read.readable[Symbol.asyncIterator]();
  await write.writable.write(Uint8Array.of(0, 255));
  assert.deepEqual(await replacement.next(), { done: false, value: Uint8Array.of(0, 255) });
  await replacement.return?.();
  await Promise.all([read.close(), write.close()]);
});

test("read aliases and independent borrows share one nonduplicating cursor", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = read.acquire();
  const first = read.readable[Symbol.asyncIterator]();
  const second = alias.readable[Symbol.asyncIterator]();
  const pendingFirst = first.next();
  const pendingSecond = second.next();
  await write.writable.write(Uint8Array.of(1));
  await write.writable.write(Uint8Array.of(2));
  assert.deepEqual((await pendingFirst).value, Uint8Array.of(1));
  assert.deepEqual((await pendingSecond).value, Uint8Array.of(2));
  await write.close();
  assert.equal((await first.next()).done, true);
  assert.equal((await second.next()).done, true);
  await Promise.all([read.close(), alias.close()]);
});

test("observation does not consume bytes or keep the last writer alive", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const blocked = read.probe();
  const waiting = read.waitForChange(blocked.revision, { timeoutMs: 1000 });
  await write.close();
  const observed = await waiting;
  assert.equal(observed?.ready, true);
  assert.equal(observed?.peerClosed, true);
  assert.equal((await read.readable[Symbol.asyncIterator]().next()).done, true);
  await read.close();
});

test("last reader closure is normal directional state, not whole-pipe failure", async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ signal: controller.signal, highWaterMark: 1 });
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  await write.writable.write(Uint8Array.of(1));
  const pending = assert.rejects(write.writable.write(Uint8Array.of(2)), { code: "EPIPE" });
  const waiting = write.waitForChange(write.probe().revision, { timeoutMs: 1000 });
  await read.close();
  await pending;
  assert.equal((await waiting)?.ready, true);
  assert.equal(write.probe().peerClosed, true);
  assert.equal(controller.signal.aborted, false);
  assert.equal(write.writable.ownedOutput?.consumerClosed.aborted, true);
  await assert.rejects(write.writable.write(Uint8Array.of(3)), { code: "EPIPE" });
  await write.close();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("closing one reader alias cancels only its pending borrow and observations", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = read.acquire();
  const borrowed = read.readable[Symbol.asyncIterator]();
  const pending = assert.rejects(borrowed.next(), { code: "EBADF" });
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000 }), { code: "EBADF" });
  await read.close();
  await Promise.all([pending, waiting]);
  assert.equal(write.probe().peerClosed, false);
  await write.writable.write(Uint8Array.of(42));
  assert.deepEqual((await alias.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(42));
  await Promise.all([alias.close(), write.close()]);
});

test("closing a writer drops its peer reference before admitted writes drain", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  await write.writable.write(Uint8Array.of(1));
  const writing = write.writable.write(Uint8Array.of(2));
  const closing = write.close();
  assert.equal(read.probe().peerClosed, true);
  await assert.rejects(write.writable.write(Uint8Array.of(3)), { code: "EBADF" });
  const reader = read.readable[Symbol.asyncIterator]();
  assert.deepEqual((await reader.next()).value, Uint8Array.of(1));
  await Promise.all([writing, closing]);
  assert.deepEqual((await reader.next()).value, Uint8Array.of(2));
  assert.equal((await reader.next()).done, true);
  await read.close();
});

test("wait registration cannot miss a transition before subscription or consume its payload", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const before = read.probe();
  await write.writable.write(Uint8Array.of(7));
  const observed = await read.waitForChange(before.revision, { timeoutMs: 0 });
  assert.equal(observed?.ready, true);
  assert.notEqual(observed?.revision, before.revision);
  const reader = read.readable[Symbol.asyncIterator]();
  assert.deepEqual((await reader.next()).value, Uint8Array.of(7));
  const backToBlocked = await read.waitForChange(before.revision, { timeoutMs: 0 });
  assert.equal(backToBlocked?.ready, false);
  assert.notEqual(backToBlocked?.revision, before.revision);
  await reader.return?.();
  await Promise.all([read.close(), write.close()]);
});

test("write-end read-select does not become ready merely because bytes are buffered", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const waiting = write.waitForChange(write.probe().revision, { timeoutMs: 1000 });
  await write.writable.write(Uint8Array.of(1));
  assert.equal((await waiting)?.ready, false);
  assert.equal(write.probe().ready, false);
  assert.equal(await write.waitForChange(write.probe().revision, { timeoutMs: 0 }), undefined);
  await Promise.all([read.close(), write.close()]);
});

for (const reason of [false, 0, "", null]) test(`wait cancellation preserves falsey reason without closing peers: ${String(reason)}`, async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const controller = new AbortController();
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: controller.signal }), error => Object.is(error, reason));
  controller.abort(reason);
  await waiting;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(write.probe().peerClosed, false);
  await write.writable.write(Uint8Array.of(9));
  assert.deepEqual((await read.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(9));
  await Promise.all([read.close(), write.close()]);
});

for (const reason of [false, 0, "", null]) test(`explicit pipe failure preserves falsey identity across aliases and waits: ${String(reason)}`, async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = write.acquire();
  await write.writable.write(Uint8Array.of(1));
  const pending = assert.rejects(alias.writable.write(Uint8Array.of(2)), error => Object.is(error, reason));
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000 }), error => Object.is(error, reason));
  await pipe.abort(reason);
  await Promise.all([pending, waiting]);
  assert.throws(() => write.probe(), error => Object.is(error, reason));
  await assert.rejects(read.readable[Symbol.asyncIterator]().next(), error => Object.is(error, reason));
  assert.equal(write.writable.ownedOutput?.consumerClosed.reason, reason);
  await Promise.all([read.close(), write.close(), alias.close()]);
});

test("timeout detaches observation without acquiring an endpoint reference", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const controller = new AbortController();
  assert.equal(await read.waitForChange(read.probe().revision, { timeoutMs: 1, signal: controller.signal }), undefined);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await read.close();
  assert.equal(write.probe().ready, true);
  await write.close();
});

test("observation deadlines and revision inputs reject malformed values", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  for (const timeoutMs of [-1, 0.5, NaN, Infinity, 2147483648]) {
    await assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs }), RangeError);
  }
  await assert.rejects(read.waitForChange(-1n, { timeoutMs: 0 }), RangeError);
  await assert.rejects(read.waitForChange(read.probe().revision + 1n, { timeoutMs: 0 }), RangeError);
  await Promise.all([read.close(), write.close()]);
});

test("pending observation count is bounded and cancellation releases every slot", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const controllers = Array.from({ length: 64 }, () => new AbortController());
  const waits = controllers.map(controller => assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: controller.signal }), error => error === false));
  await assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000 }), RangeError);
  for (const controller of controllers) controller.abort(false);
  await Promise.all(waits);
  assert.equal(await read.waitForChange(read.probe().revision, { timeoutMs: 0 }), undefined);
  await Promise.all([read.close(), write.close()]);
});

test("legacy iterator return still fails the legacy pipe while endpoint borrow return does not", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const borrowed = pipe.endpoints.read.readable[Symbol.asyncIterator]();
  await borrowed.return?.();
  assert.equal(pipe.endpoints.write.probe().peerClosed, false);
  await pipe.readable[Symbol.asyncIterator]().return?.();
  assert.throws(() => pipe.readiness(), error => error instanceof FsError && error.code === "EPIPE");
  await assert.rejects(pipe.writable.write(Uint8Array.of(1)), { code: "EPIPE" });
});

test("endpoint capability remains optional for existing external BytePipe implementations", async () => {
  const pipe: BytePipe = {
    readable: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(1); } },
    writable: { async write() {} },
    readiness: () => "ready",
    async close() {},
    async abort() {},
  };
  assert.equal(pipe.endpoints, undefined);
  assert.deepEqual((await pipe.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(1));
});

test("throwing into a borrowed iterator does not fail its endpoint or another borrow", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const borrowed = read.readable[Symbol.asyncIterator]();
  const pending = borrowed.next();
  await assert.rejects(borrowed.throw!(false), error => error === false);
  assert.equal((await pending).done, true);
  assert.equal(write.probe().peerClosed, false);
  await write.writable.write(Uint8Array.of(3));
  assert.deepEqual((await read.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(3));
  await Promise.all([read.close(), write.close()]);
});

test("wait captures its cancellation signal once and removes the selected listener", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const selected = new AbortController();
  const unrelated = new AbortController();
  let reads = 0;
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, {
    timeoutMs: 1000,
    get signal() { reads++; return reads === 1 ? selected.signal : unrelated.signal; },
  }), error => error === false);
  selected.abort(false);
  await waiting;
  assert.equal(reads, 1);
  assert.equal(getEventListeners(selected.signal, "abort").length, 0);
  assert.equal(getEventListeners(unrelated.signal, "abort").length, 0);
  await Promise.all([read.close(), write.close()]);
});

test("failed observation listener admission releases its reserved waiter slot", async context => {
  const pipe = createBytePipe();
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const failing = new AbortController();
  const registration = context.mock.method(failing.signal, "addEventListener", () => { throw false; });
  await assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: failing.signal }), error => error === false);
  registration.mock.restore();
  const controllers = Array.from({ length: 64 }, () => new AbortController());
  const waits = controllers.map(controller => assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: controller.signal }), error => error === false));
  for (const controller of controllers) controller.abort(false);
  await Promise.all(waits);
  assert.equal(getEventListeners(failing.signal, "abort").length, 0);
  await Promise.all([read.close(), write.close()]);
});

test("explicit cancellation remains distinct from earlier normal final-reader closure", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  await read.close();
  assert.equal(write.probe().ready, true);
  const waiting = assert.rejects(write.waitForChange(write.probe().revision, { timeoutMs: 1000 }), error => error === false);
  await pipe.abort(false);
  await waiting;
  await assert.rejects(write.writable.write(Uint8Array.of(1)), error => error === false);
  await write.close();
});

test("a cancellation during observation registration also retires a late-admitted listener", async context => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const controller = new AbortController();
  const register = controller.signal.addEventListener.bind(controller.signal);
  context.mock.method(controller.signal, "addEventListener", (...args: Parameters<typeof register>) => {
    void pipe.abort(false);
    register(...args);
  });
  await assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: controller.signal }), error => error === false);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await Promise.all([read.close(), write.close()]);
});

test("post-EOF observation still owns cancellation without undoing legacy completion", async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ signal: controller.signal });
  assert.ok(pipe.endpoints);
  const { read } = pipe.endpoints;
  await pipe.close();
  assert.equal((await pipe.readable[Symbol.asyncIterator]().next()).done, true);
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 50 }), error => error === false);
  controller.abort(false);
  await waiting;
  await pipe.close();
  await read.close();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("explicit abort retires post-EOF observations without undoing legacy completion", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read } = pipe.endpoints;
  await pipe.close();
  assert.equal((await pipe.readable[Symbol.asyncIterator]().next()).done, true);
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 50 }), error => error === false);
  await pipe.abort(false);
  await waiting;
  await pipe.close();
  await read.close();
});

test("observers sharing the pipe cancellation signal share its one root listener", async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ signal: controller.signal });
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const waits = Array.from({ length: 64 }, () => assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: controller.signal }), error => error === false));
  try { assert.equal(getEventListeners(controller.signal, "abort").length, 1); }
  finally { controller.abort(false); await Promise.all(waits); }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await Promise.all([read.close(), write.close()]);
});

const exactFailureChannels = [
  { name: "legacy writable failure hook", async fail(pipe: BytePipe) {
    const failure = pipe.writable[outputFailure];
    assert.ok(failure);
    await failure(undefined);
  } },
  { name: "endpoint writable failure hook", async fail(pipe: BytePipe) {
    const failure = pipe.endpoints?.write.writable[outputFailure];
    assert.ok(failure);
    await failure(undefined);
  } },
  { name: "owned legacy iterator throw", async fail(pipe: BytePipe) {
    const iterator = pipe.readable[Symbol.asyncIterator]();
    assert.ok(iterator.throw);
    await assert.rejects(iterator.throw(undefined), reason => reason === undefined);
  } },
];

for (const channel of exactFailureChannels) for (const blocked of ["reader", "writer"]) {
  test(`exact undefined failure: ${channel.name}, blocked ${blocked}`, async context => {
    const pipe = createBytePipe({ highWaterMark: 1 });
    context.after(() => pipe.abort());
    assert.ok(pipe.endpoints);
    const { read, write } = pipe.endpoints;
    const alias = write.acquire();
    if (blocked === "writer") await pipe.writable.write(Uint8Array.of(1));
    const operation = blocked === "writer"
      ? alias.writable.write(Uint8Array.of(2))
      : read.readable[Symbol.asyncIterator]().next();
    const observed = Promise.all([
      assert.rejects(operation, reason => reason === undefined),
      assert.rejects(write.waitForChange(write.probe().revision, { timeoutMs: 1000 }), reason => reason === undefined),
    ]);
    void observed.catch(() => {});
    await channel.fail(pipe);
    await observed;
    assert.throws(() => pipe.readiness(), reason => reason === undefined);
    assert.throws(() => read.probe(), reason => reason === undefined);
    assert.throws(() => alias.probe(), reason => reason === undefined);
    await assert.rejects(pipe.writable.write(Uint8Array.of(3)), reason => reason === undefined);
    await assert.rejects(write.writable.write(Uint8Array.of(4)), reason => reason === undefined);
    await assert.rejects(read.readable[Symbol.asyncIterator]().next(), reason => reason === undefined);
    await assert.rejects(pipe.close(), reason => reason === undefined);
    assert.equal(write.writable.ownedOutput?.consumerClosed.aborted, true);
    assert.notEqual(write.writable.ownedOutput?.consumerClosed.reason, undefined);
    await pipe.abort(new Error("later failure"));
    await assert.rejects(alias.writable.write(Uint8Array.of(5)), reason => reason === undefined);
    await Promise.all([read.close(), write.close(), alias.close()]);
  });
}

for (const explicitUndefined of [false, true]) test(`legacy abort default remains EPIPE, explicit undefined=${explicitUndefined}`, async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  if (explicitUndefined) await pipe.abort(undefined);
  else await pipe.abort();
  assert.throws(() => pipe.readiness(), { code: "EPIPE" });
  assert.throws(() => pipe.endpoints!.read.probe(), { code: "EPIPE" });
  await assert.rejects(pipe.writable.write(Uint8Array.of(1)), { code: "EPIPE" });
  await assert.rejects(pipe.endpoints.read.readable[Symbol.asyncIterator]().next(), { code: "EPIPE" });
  await assert.rejects(pipe.close(), { code: "EPIPE" });
  await Promise.all([pipe.endpoints.read.close(), pipe.endpoints.write.close()]);
});

test("undefined failure from an acquired writer alias is shared by the retained resource", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = write.acquire();
  await write.close();
  const failure = alias.writable[outputFailure];
  assert.ok(failure);
  await failure(undefined);
  assert.throws(() => read.probe(), reason => reason === undefined);
  await assert.rejects(alias.writable.write(Uint8Array.of(1)), reason => reason === undefined);
  await assert.rejects(read.readable[Symbol.asyncIterator]().next(), reason => reason === undefined);
  await Promise.all([read.close(), alias.close()]);
});

for (const channel of exactFailureChannels) test(`post-EOF observation preserves undefined from ${channel.name}`, async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read } = pipe.endpoints;
  await pipe.close();
  assert.equal((await pipe.readable[Symbol.asyncIterator]().next()).done, true);
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000 }), reason => reason === undefined);
  void waiting.catch(() => {});
  await channel.fail(pipe);
  await waiting;
  await pipe.close();
  await read.close();
});

test("undefined thrown into an endpoint borrow stays lease-local", async () => {
  const pipe = createBytePipe();
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const borrowed = read.readable[Symbol.asyncIterator]();
  const pending = borrowed.next();
  assert.ok(borrowed.throw);
  await assert.rejects(borrowed.throw(undefined), reason => reason === undefined);
  assert.equal((await pending).done, true);
  assert.equal(write.probe().peerClosed, false);
  await write.writable.write(Uint8Array.of(6));
  assert.deepEqual((await read.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(6));
  await Promise.all([read.close(), write.close()]);
});
