import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createBytePipe } from "../../src/contracts/io.js";

test("endpoint review: interleaved leases cancel their own queued reads without becoming peer references", async context => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = read.acquire();
  const before = write.probe();
  const first = read.readable[Symbol.asyncIterator]();
  const cancelled = read.readable[Symbol.asyncIterator]();
  const third = alias.readable[Symbol.asyncIterator]();
  assert.deepEqual(write.probe(), before);
  const firstHead = first.next();
  const cancelledHead = cancelled.next();
  const firstTail = first.next();
  const cancelledTail = cancelled.next();
  const thirdHead = third.next();
  await cancelled.return?.();
  assert.deepEqual(await Promise.all([cancelledHead, cancelledTail]), [{ done: true, value: undefined }, { done: true, value: undefined }]);
  assert.deepEqual(write.probe(), before);
  for (const bytes of [Uint8Array.of(255, 0), Uint8Array.of(128, 10), Uint8Array.of(254)]) await write.writable.write(bytes);
  assert.deepEqual((await firstHead).value, Uint8Array.of(255, 0));
  assert.deepEqual((await firstTail).value, Uint8Array.of(128, 10));
  assert.deepEqual((await thirdHead).value, Uint8Array.of(254));
  await assert.rejects(first.throw!(false), reason => Object.is(reason, false));
  await read.close();
  assert.equal(write.probe().peerClosed, false);
  await write.writable.write(Uint8Array.of(0, 255));
  assert.deepEqual((await third.next()).value, Uint8Array.of(0, 255));
  await alias.close();
  assert.equal(write.probe().peerClosed, true);
  await third.return?.();
  await write.close();
});

test("endpoint review: final reader closure rejects every blocked writer while surviving writer aliases stay observable", async context => {
  const root = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: root.signal });
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const readerAlias = read.acquire();
  const writerAlias = write.acquire();
  const closingWriter = write.acquire();
  const unpulled = readerAlias.readable[Symbol.asyncIterator]();
  await write.writable.write(Uint8Array.of(1));
  let firstSettled = false;
  let secondSettled = false;
  const first = assert.rejects(writerAlias.writable.write(Uint8Array.of(2)).finally(() => { firstSettled = true; }), { code: "EPIPE" });
  const second = assert.rejects(closingWriter.writable.write(Uint8Array.of(3)).finally(() => { secondSettled = true; }), { code: "EPIPE" });
  let closeSettled = false;
  const writerClosing = closingWriter.close().then(() => { closeSettled = true; });
  await read.close();
  await nextTurn();
  assert.deepEqual([firstSettled, secondSettled, closeSettled], [false, false, false]);
  assert.equal(write.writable.ownedOutput?.consumerClosed.aborted, false);
  await readerAlias.close();
  await Promise.all([first, second, writerClosing]);
  assert.equal(root.signal.aborted, false);
  for (const endpoint of [write, writerAlias]) {
    assert.equal(endpoint.probe().peerClosed, true);
    assert.equal(endpoint.probe().ready, true);
    await assert.rejects(endpoint.writable.write(Uint8Array.of(4)), { code: "EPIPE" });
  }
  await assert.rejects(closingWriter.writable.write(Uint8Array.of(4)), { code: "EBADF" });
  await assert.rejects(unpulled.next(), { code: "EBADF" });
  await Promise.all([write.close(), writerAlias.close(), unpulled.return?.()]);
  assert.equal(getEventListeners(root.signal, "abort").length, 0);
});

test("endpoint review: queued oversized Buffer views retain admission bytes across mutation and alias closure", async context => {
  const pipe = createBytePipe({ highWaterMark: 3 });
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = write.acquire();
  await write.writable.write(Uint8Array.of(1, 2, 3));
  const storage = Buffer.from([77, 255, 0, 128, 10, 254, 13, 92, 39, 88]);
  const chunk = storage.subarray(1, 9);
  const expected = Uint8Array.from(chunk);
  let oversizedAccepted = false;
  let tailAccepted = false;
  const oversized = alias.writable.write(chunk).then(() => { oversizedAccepted = true; });
  const tail = write.writable.write(chunk.subarray(0, 2)).then(() => { tailAccepted = true; });
  storage.fill(65);
  const closing = alias.close();
  await nextTurn();
  assert.deepEqual([oversizedAccepted, tailAccepted], [false, false]);
  const reader = read.readable[Symbol.asyncIterator]();
  assert.deepEqual((await reader.next()).value, Uint8Array.of(1, 2, 3));
  await Promise.all([oversized, closing]);
  assert.equal(tailAccepted, false);
  const payload = (await reader.next()).value;
  assert.deepEqual(payload, expected);
  payload.fill(66);
  await tail;
  assert.deepEqual((await reader.next()).value, Uint8Array.of(255, 0));
  await write.close();
  assert.equal((await reader.next()).done, true);
  await Promise.all([reader.return?.(), read.close()]);
});

test("endpoint review: empty writes under backpressure neither change revision nor wake observation", async context => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  await write.writable.write(Uint8Array.of(255));
  const before = read.probe();
  const local = new AbortController();
  let settled = false;
  const waiting = assert.rejects(read.waitForChange(before.revision, { timeoutMs: 1000, signal: local.signal }).finally(() => { settled = true; }), reason => Object.is(reason, false));
  await write.writable.write(new Uint8Array());
  await nextTurn();
  assert.deepEqual(read.probe(), before);
  assert.equal(settled, false);
  local.abort(false);
  await waiting;
  assert.equal(getEventListeners(local.signal, "abort").length, 0);
  assert.deepEqual((await read.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(255));
  await Promise.all([read.close(), write.close()]);
});

for (const rootReason of [false, 0, "", null]) test(`endpoint review: already settled local wait remains local while root failure ${String(rootReason)} reaches other work`, async context => {
  const root = new AbortController();
  const local = new AbortController();
  const survivor = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: root.signal });
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const alias = write.acquire();
  await write.writable.write(Uint8Array.of(7));
  const localReason = new Error("only this observation was cancelled");
  const cancelled = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: local.signal }), reason => Object.is(reason, localReason));
  const waiting = assert.rejects(alias.waitForChange(alias.probe().revision, { timeoutMs: 1000, signal: survivor.signal }), reason => Object.is(reason, rootReason));
  const blocked = assert.rejects(alias.writable.write(Uint8Array.of(8)), reason => Object.is(reason, rootReason));
  local.abort(localReason);
  await cancelled;
  assert.equal(alias.probe().peerClosed, false);
  root.abort(rootReason);
  await Promise.all([waiting, blocked]);
  assert.equal(survivor.signal.aborted, false);
  assert.equal(write.writable.ownedOutput?.consumerClosed.aborted, true);
  assert.ok(Object.is(write.writable.ownedOutput?.consumerClosed.reason, rootReason));
  await assert.rejects(read.waitForChange(0n, { timeoutMs: 0, signal: local.signal }), reason => Object.is(reason, rootReason));
  await Promise.all([read.close(), write.close(), alias.close()]);
  for (const signal of [root.signal, local.signal, survivor.signal]) assert.equal(getEventListeners(signal, "abort").length, 0);
});

test("endpoint review: registration-time write cannot lose its wake or leave a late timer/listener", async context => {
  const pipe = createBytePipe();
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const controller = new AbortController();
  const register = controller.signal.addEventListener.bind(controller.signal);
  let writing: Promise<void> | undefined;
  context.mock.method(controller.signal, "addEventListener", (...args: Parameters<typeof register>) => {
    register(...args);
    writing = write.writable.write(Uint8Array.of(255, 0, 10));
  });
  const timer = context.mock.method(globalThis, "setTimeout");
  const before = read.probe();
  const observed = await read.waitForChange(before.revision, { timeoutMs: 1000, signal: controller.signal });
  await writing;
  assert.ok(observed);
  assert.equal(observed.ready, true);
  assert.ok(observed.revision > before.revision);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(timer.mock.callCount(), 0);
  assert.deepEqual((await read.readable[Symbol.asyncIterator]().next()).value, Uint8Array.of(255, 0, 10));
  await Promise.all([read.close(), write.close()]);
});

test("endpoint review: buffered-to-empty ABA during options capture returns changed revision without fabricated readiness", async context => {
  const pipe = createBytePipe();
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const reader = read.readable[Symbol.asyncIterator]();
  const before = read.probe();
  let writing: Promise<void> | undefined;
  let consumed: Promise<IteratorResult<Uint8Array>> | undefined;
  const observed = await read.waitForChange(before.revision, { get timeoutMs() {
    writing = write.writable.write(Uint8Array.of(128, 0));
    consumed = reader.next();
    return 0;
  } });
  await writing;
  assert.deepEqual((await consumed)?.value, Uint8Array.of(128, 0));
  assert.ok(observed);
  assert.ok(observed.revision > before.revision);
  assert.equal(observed.ready, false);
  assert.equal(observed.peerClosed, false);
  assert.equal(before.ready, false);
  assert.ok(Object.isFrozen(before));
  await Promise.all([reader.return?.(), read.close(), write.close()]);
});

test("endpoint review: timeout, transition and endpoint close retire timers and listeners and release waiter capacity", async context => {
  const pipe = createBytePipe();
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const timers = context.mock.method(globalThis, "setTimeout");
  const clears = context.mock.method(globalThis, "clearTimeout");
  const timeout = new AbortController();
  assert.equal(await read.waitForChange(read.probe().revision, { timeoutMs: 1, signal: timeout.signal }), undefined);
  assert.equal(getEventListeners(timeout.signal, "abort").length, 0);
  for (let iteration = 0; iteration < 70; iteration++) {
    const local = new AbortController();
    const waiting = read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: local.signal });
    const alias = write.acquire();
    assert.ok(await waiting);
    await alias.close();
    assert.equal(getEventListeners(local.signal, "abort").length, 0);
  }
  const closing = new AbortController();
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, { timeoutMs: 1000, signal: closing.signal }), { code: "EBADF" });
  await read.close();
  await waiting;
  await write.close();
  assert.equal(getEventListeners(closing.signal, "abort").length, 0);
  assert.equal(timers.mock.callCount(), 72);
  assert.equal(clears.mock.callCount(), 72);
  assert.deepEqual(clears.mock.calls.map(call => call.arguments[0]), timers.mock.calls.map(call => call.result));
});

test("endpoint review: captured wait options ignore later mutation and an unrelated aborted signal", async context => {
  const pipe = createBytePipe();
  context.after(() => pipe.abort());
  assert.ok(pipe.endpoints);
  const { read, write } = pipe.endpoints;
  const selected = new AbortController();
  const unrelated = new AbortController();
  const options = { timeoutMs: 1000, signal: selected.signal };
  const waiting = assert.rejects(read.waitForChange(read.probe().revision, options), reason => Object.is(reason, null));
  options.timeoutMs = -1;
  options.signal = unrelated.signal;
  unrelated.abort(false);
  selected.abort(null);
  await waiting;
  assert.equal(write.probe().peerClosed, false);
  assert.equal(getEventListeners(selected.signal, "abort").length, 0);
  assert.equal(getEventListeners(unrelated.signal, "abort").length, 0);
  await Promise.all([read.close(), write.close()]);
});

test("endpoint review: legacy close drains admitted backpressured writes without requiring endpoint access", async context => {
  const root = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: root.signal });
  context.after(() => pipe.abort());
  await pipe.writable.write(Uint8Array.of(255));
  const bytes = Buffer.from([0, 128, 10]);
  const writing = pipe.writable.write(bytes);
  bytes.fill(65);
  let closed = false;
  const closing = pipe.close().then(() => { closed = true; });
  await nextTurn();
  assert.equal(closed, false);
  await assert.rejects(pipe.writable.write(Uint8Array.of(7)), { code: "EPIPE" });
  const reader = pipe.readable[Symbol.asyncIterator]();
  assert.deepEqual((await reader.next()).value, Uint8Array.of(255));
  await Promise.all([writing, closing]);
  assert.deepEqual((await reader.next()).value, Uint8Array.of(0, 128, 10));
  assert.equal((await reader.next()).done, true);
  assert.equal(pipe.readiness(), "eof");
  assert.equal(getEventListeners(root.signal, "abort").length, 0);
});

for (const reason of [false, 0, "", null]) test(`endpoint review: legacy abort ${String(reason)} preserves queued write and close failures without endpoint access`, async context => {
  const root = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: root.signal });
  context.after(() => pipe.abort());
  await pipe.writable.write(Uint8Array.of(1));
  const writing = assert.rejects(pipe.writable.write(Uint8Array.of(2)), error => Object.is(error, reason));
  const closing = assert.rejects(pipe.close(), error => Object.is(error, reason));
  root.abort(reason);
  await Promise.all([writing, closing]);
  assert.throws(() => pipe.readiness(), error => Object.is(error, reason));
  await assert.rejects(pipe.readable[Symbol.asyncIterator]().next(), error => Object.is(error, reason));
  assert.ok(Object.is(pipe.writable.ownedOutput?.consumerClosed.reason, reason));
  assert.equal(getEventListeners(root.signal, "abort").length, 0);
});

test("endpoint review: legacy iterator return aborts an outstanding next without endpoint access", async context => {
  const root = new AbortController();
  const pipe = createBytePipe({ signal: root.signal });
  context.after(() => pipe.abort());
  const reader = pipe.readable[Symbol.asyncIterator]();
  const reading = assert.rejects(reader.next(), { code: "EPIPE" });
  await reader.return?.();
  await reading;
  assert.throws(() => pipe.readiness(), { code: "EPIPE" });
  await assert.rejects(pipe.writable.write(Uint8Array.of(255)), { code: "EPIPE" });
  assert.equal(root.signal.aborted, false);
  assert.equal(getEventListeners(root.signal, "abort").length, 0);
});
