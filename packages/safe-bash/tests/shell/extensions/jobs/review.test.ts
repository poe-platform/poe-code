import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createJobState, type JobTaskContext } from "../../../../src/shell/extensions/jobs/state.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

test("review: cancelled late preparation must not acquire a runner getter after cleanup closes", async () => {
  const state = createJobState();
  const prepared = deferred<void>();
  let reads = 0;
  let runs = 0;
  let cleaned = 0;
  const starting = state.start(async owner => {
    owner.registerCleanup(() => { cleaned++; });
    await prepared.promise;
    return { get run() { reads++; return () => { runs++; return 0; }; } };
  });
  const rejected = assert.rejects(starting, error => error === false);
  const closing = state.close(false);
  try {
    prepared.resolve();
    await rejected;
    await closing;
    assert.equal(cleaned, 1);
    assert.equal(runs, 0);
    assert.equal(reads, 0, "closed preparation cannot admit runner property acquisition");
    assert.deepEqual(state.snapshot(), []);
  } finally { prepared.resolve(); await rejected; await closing; }
});

test("review: natural finish permits late runner acquisition and cleanup registration without cancellation", async () => {
  const state = createJobState();
  const prepared = deferred<void>();
  const cleanup = deferred<void>();
  let owner!: JobTaskContext;
  let finishingSettled = false;
  let cleaned = 0;
  const starting = state.start(async context => {
    owner = context;
    await prepared.promise;
    return { get run() {
      context.registerCleanup(async () => { await cleanup.promise; cleaned++; });
      return () => 23;
    } };
  });
  const finishing = state.finish();
  void finishing.then(() => { finishingSettled = true; }, () => { finishingSettled = true; });
  try {
    prepared.resolve();
    const handle = await starting;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(owner.signal.aborted, false);
    assert.equal(finishingSettled, false);
    cleanup.resolve();
    await finishing;
    assert.equal(cleaned, 1);
    assert.deepEqual(await handle.completion, { kind: "status", status: 23 });
    assert.equal(state.close(false), finishing);
    assert.equal(owner.signal.aborted, false);
  } finally { prepared.resolve(); cleanup.resolve(); await finishing; }
});

test("review: a runner getter acquired after cancellation cannot replace the primary cancellation reason", async () => {
  const state = createJobState();
  const prepared = deferred<void>();
  const secondary = new Error("late getter must not run");
  let reads = 0;
  const starting = state.start(async () => {
    await prepared.promise;
    return { get run(): () => number { reads++; throw secondary; } };
  });
  const outcome = starting.then(() => ({ resolved: true as const }), reason => ({ reason }));
  const closing = state.close(0);
  try {
    prepared.resolve();
    assert.deepEqual(await outcome, { reason: 0 });
    assert.equal(reads, 0);
  } finally { prepared.resolve(); await outcome; await closing; }
});

test("review: an already admitted preparation rejection still outranks local close after cleanup drains", async () => {
  const state = createJobState();
  const preparation = deferred<never>();
  const cleanup = deferred<void>();
  let settled = false;
  const starting = state.start(async owner => {
    owner.registerCleanup(() => cleanup.promise);
    return preparation.promise;
  });
  void starting.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(starting, reason => reason === false);
  const closing = state.close(0);
  try {
    preparation.reject(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    cleanup.resolve();
    await rejected;
    await closing;
    assert.deepEqual(state.snapshot(), []);
  } finally { preparation.reject(false); cleanup.resolve(); await rejected; await closing; }
});

for (const reason of [undefined, null, false, 0, ""]) {
  test(`review: falsey preparation failure waits for cleanup and wins over its rejection: ${String(reason)}`, async () => {
    const state = createJobState({ maxJobs: 1 });
    const cleanup = deferred<void>();
    const secondary = new Error("secondary cleanup");
    let settled = false;
    const starting = state.start(owner => {
      owner.registerCleanup(async () => { await cleanup.promise; throw secondary; });
      throw reason;
    });
    void starting.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(starting, error => Object.is(error, reason));
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      let admitted = false;
      await assert.rejects(state.start(() => { admitted = true; return { run: () => 0 }; }), /maxJobs/);
      assert.equal(admitted, false);
      cleanup.resolve();
      await rejected;
      assert.deepEqual(state.snapshot(), []);
      const next = await state.start(() => ({ run: () => 19 }));
      assert.equal(next.jobId, 1);
      assert.deepEqual(await next.completion, { kind: "status", status: 19 });
    } finally { cleanup.resolve(); await rejected; await state.close(); }
  });
}

test("review: cancelled waiter does not retire pending preparation or its eventual status", async () => {
  const owner = new AbortController();
  const waiter = new AbortController();
  const prepared = deferred<void>();
  const state = createJobState({ signal: owner.signal, maxWaiters: 1 });
  let context!: JobTaskContext;
  const starting = state.start(async task => { context = task; await prepared.promise; return { run: () => 41 }; });
  const handle = state.snapshot()[0]!.handle;
  const waiting = state.wait([{ handle }], { signal: waiter.signal });
  const rejected = assert.rejects(waiting, error => error === null);
  try {
    assert.equal(getEventListeners(waiter.signal, "abort").length, 1);
    waiter.abort(null);
    await rejected;
    assert.equal(getEventListeners(waiter.signal, "abort").length, 0);
    assert.equal(context.signal.aborted, false);
    assert.equal(state.snapshot()[0]!.state, "preparing");
    prepared.resolve();
    assert.equal(await starting, handle);
    assert.deepEqual((await state.wait([{ handle }])).outcome, { kind: "status", status: 41 });
    await state.finish();
    assert.equal(getEventListeners(owner.signal, "abort").length, 0);
  } finally { prepared.resolve(); await rejected; await starting; await state.close(); }
});

test("review: natural finish cannot settle until all admitted preparation and cleanup receipts complete", async () => {
  const state = createJobState();
  const preparation = deferred<void>();
  const firstCleanup = deferred<void>();
  const secondCleanup = deferred<void>();
  let cleaned = 0;
  let finished = false;
  const first = state.start(async owner => {
    owner.registerCleanup(async () => { await firstCleanup.promise; cleaned++; });
    await preparation.promise;
    return { run: () => 7 };
  });
  const second = await state.start(owner => {
    owner.registerCleanup(async () => { await secondCleanup.promise; cleaned++; });
    return { run: () => 9 };
  });
  const finishing = state.finish();
  void finishing.then(() => { finished = true; });
  try {
    secondCleanup.resolve();
    assert.deepEqual(await second.completion, { kind: "status", status: 9 });
    assert.equal(finished, false);
    preparation.resolve();
    const handle = await first;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    firstCleanup.resolve();
    await finishing;
    assert.equal(cleaned, 2);
    assert.deepEqual(await handle.completion, { kind: "status", status: 7 });
  } finally { preparation.resolve(); firstCleanup.resolve(); secondCleanup.resolve(); await first; await finishing; }
});
