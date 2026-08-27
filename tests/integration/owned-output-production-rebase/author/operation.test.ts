import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOutputOperation, createBytePipe, FsError,
  type ByteSink, type InvocationCleanup,
} from "../../../../src/contracts/index.js";
import { bytes, deferred, discard, remainsPending, turn } from "./helpers.js";

test("registration precedes acquisition, close is shared, late admission has no effects", async () => {
  const events: string[] = [];
  let registered!: InvocationCleanup;
  const operation = createOutputOperation({ signal: new AbortController().signal, registerCleanup(cleanup) {
    events.push("registered"); registered = cleanup;
  } }, discard);
  assert.equal(await operation.acquire(() => { events.push("start"); return 42; }, value => {
    assert.equal(value, 42); events.push("release");
  }), 42);
  const closing = operation.close();
  assert.equal(operation.close(), closing);
  assert.equal(registered(), closing);
  await assert.rejects(operation.acquire(() => { events.push("late-start"); }, () => {}), /closed/);
  await assert.rejects(operation.output.write(bytes("late")), /closed/);
  assert.throws(() => operation.child(discard), /closed/);
  assert.throws(() => operation.registerCleanup(() => { events.push("late-cleanup"); }), /closed/);
  await closing;
  assert.deepEqual(events, ["registered", "start", "release"]);
});

test("failed registration prevents acquisition and preclosed signals prevent all effects", async () => {
  const failure = new Error("registration refused");
  assert.throws(() => createOutputOperation({ signal: new AbortController().signal, registerCleanup() { throw failure; } }, discard), error => error === failure);
  const caller = new AbortController();
  const consumer = new AbortController();
  const reason = { caller: true };
  caller.abort(reason);
  consumer.abort(new FsError("EPIPE"));
  let effects = 0;
  const sink = { async write() { effects++; } };
  const operation = createOutputOperation({ signal: caller.signal }, { ...sink, ownedOutput: { ...sink, consumerClosed: consumer.signal } });
  await assert.rejects(operation.acquire(() => { effects++; }, () => {}), error => error === reason);
  await assert.rejects(operation.output.write(bytes("no")), error => error === reason);
  assert.equal(operation.signal.reason, reason);
  await operation.close();
  assert.equal(effects, 0);
});

test("close drains an acquisition already pending, including its delayed release", { timeout: 2000 }, async () => {
  const acquired = deferred<object>();
  const released = deferred();
  const releasing = deferred();
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  const value = {};
  let releaseCount = 0;
  const acquisition = assert.rejects(operation.acquire(() => acquired.promise, async resource => {
    assert.equal(resource, value); releaseCount++; releasing.resolve(); await released.promise;
  }), /closed/);
  const closing = operation.close();
  await remainsPending(closing);
  acquired.resolve(value);
  await releasing.promise;
  await remainsPending(closing);
  released.resolve();
  await Promise.all([closing, acquisition]);
  assert.equal(releaseCount, 1);
});

test("close drains rejected pending acquisition without reclassifying it as cleanup failure", { timeout: 2000 }, async () => {
  const acquired = deferred();
  const failure = new Error("acquisition rejected");
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  let releases = 0;
  const acquisition = assert.rejects(operation.acquire(() => acquired.promise, () => { releases++; }), error => error === failure);
  const closing = operation.close();
  await remainsPending(closing);
  acquired.reject(failure);
  await Promise.all([closing, acquisition]);
  assert.equal(releases, 0);
});

test("reentrant close during start still drains its admitted resource", async () => {
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  let closing!: Promise<void>;
  let released = false;
  await assert.rejects(operation.acquire(() => { closing = operation.close(); return 7; }, value => {
    assert.equal(value, 7); released = true;
  }), /closed/);
  await closing;
  assert.equal(released, true);
});

for (const origin of ["caller", "consumer"] as const) test(`late ${origin} cancellation still reaches admitted acquisition during parent close`, { timeout: 2000 }, async () => {
  const caller = new AbortController();
  const consumer = new AbortController();
  const parent = createOutputOperation({ signal: caller.signal }, { ...discard, ownedOutput: { ...discard, consumerClosed: consumer.signal } });
  const child = parent.child(discard);
  const reason = { canceled: origin };
  const acquisition = assert.rejects(child.acquire(signal => new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), () => assert.fail("no acquired resource")), error => error === reason);
  const closing = parent.close();
  await remainsPending(closing);
  assert.equal(parent.signal.aborted, false);
  assert.equal(child.signal.aborted, false);
  (origin === "caller" ? caller : consumer).abort(reason);
  await Promise.all([acquisition, closing]);
  assert.equal(child.signal.reason, reason);
});

test("synchronous acquisition rejection retains identity and releases nothing", async () => {
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  const failure = { acquisition: true };
  await assert.rejects(operation.acquire(() => { throw failure; }, () => assert.fail("not acquired")), error => error === failure);
  await operation.close();
});

test("child consumer closure isolates siblings; parent synchronously seals and drains children", { timeout: 2000 }, async () => {
  const consumer = new AbortController();
  const parent = createOutputOperation({ signal: new AbortController().signal }, discard);
  const child = parent.child({ ...discard, ownedOutput: { ...discard, consumerClosed: consumer.signal } });
  const sibling = parent.child(discard);
  const resource = deferred();
  const released = deferred();
  let cleanups = 0;
  const acquisition = assert.rejects(sibling.acquire(() => resource.promise, async () => { await released.promise; cleanups++; }), /closed/);
  consumer.abort(new FsError("EPIPE"));
  assert.equal(child.signal.aborted, true);
  assert.equal(parent.signal.aborted, false);
  assert.equal(sibling.signal.aborted, false);
  await sibling.output.write(bytes("sibling"));
  const closing = parent.close();
  assert.throws(() => sibling.child(discard), /closed/);
  await assert.rejects(sibling.acquire(() => assert.fail("late start"), () => {}), /closed/);
  await remainsPending(closing);
  resource.resolve();
  await remainsPending(closing);
  released.resolve();
  await Promise.all([closing, acquisition]);
  assert.equal(cleanups, 1);
});

test("all cleanup drains and errors retain registration order, including child failures", { timeout: 2000 }, async () => {
  const operation = createOutputOperation({ signal: new AbortController().signal }, discard);
  const first = new Error("first");
  const second = new Error("second");
  const gate = deferred();
  const cleaned: string[] = [];
  operation.registerCleanup(async () => { await gate.promise; cleaned.push("first"); throw first; });
  operation.child(discard).registerCleanup(() => { cleaned.push("second"); throw second; });
  operation.registerCleanup(() => { cleaned.push("third"); });
  const closing = operation.close();
  await remainsPending(closing);
  gate.resolve();
  await assert.rejects(closing, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
  assert.deepEqual(cleaned.slice(0, 2).sort(), ["second", "third"]);
  assert.equal(cleaned[2], "first");
  assert.equal(operation.close(), closing);
});

test("caller abort wins over consumer closure at admission and cleanup still drains", { timeout: 2000 }, async () => {
  const caller = new AbortController();
  const consumer = new AbortController();
  const operation = createOutputOperation({ signal: caller.signal }, { ...discard, ownedOutput: { ...discard, consumerClosed: consumer.signal } });
  const gate = deferred();
  const failure = new Error("cleanup");
  operation.registerCleanup(async () => { await gate.promise; throw failure; });
  consumer.abort(new FsError("EPIPE"));
  const reason = { caller: true };
  caller.abort(reason);
  await assert.rejects(operation.output.write(bytes("no")), error => error === reason);
  const closing = operation.close();
  await remainsPending(closing);
  gate.resolve();
  await assert.rejects(closing, error => error === failure);
});

test("owned output is explicit, legacy fallback unchanged, and pipe copies retained bytes", async () => {
  let normal = 0;
  let owned = 0;
  const sink: ByteSink = { async write() { normal++; }, ownedOutput: {
    consumerClosed: new AbortController().signal, async write() { owned++; },
  } };
  const enrolled = createOutputOperation({ signal: new AbortController().signal }, sink);
  await enrolled.output.write(bytes("owned"));
  await sink.write(bytes("legacy"));
  const legacy = createOutputOperation({ signal: new AbortController().signal }, { async write() { normal++; } });
  await legacy.output.write(bytes("fallback"));
  await Promise.all([enrolled.close(), legacy.close()]);
  assert.deepEqual([normal, owned], [2, 1]);
  const pipe = createBytePipe({ highWaterMark: 1 });
  const chunk = Buffer.from("a");
  await pipe.writable.ownedOutput!.write(chunk);
  chunk[0] = 98;
  const iterator = pipe.readable[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, bytes("a"));
  await iterator.return?.();
  assert.equal(pipe.writable.ownedOutput!.consumerClosed.aborted, true);
  await turn();
});
