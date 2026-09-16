import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { createJobState, type JobState, type JobTaskContext } from "../../../../src/shell/extensions/jobs/state.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function setup(context: { after(callback: () => Promise<void>): void }, options: Parameters<typeof createJobState>[0] = {}): JobState {
  const state = createJobState(options);
  context.after(async () => { await state.close(); });
  return state;
}

const status = (value: number) => ({ kind: "status", status: value });

test("owner cleanup registers before task admission", async context => {
  let cleanup: (() => Promise<void>) | undefined;
  const state = setup(context, { registerCleanup(callback) { cleanup = callback; } });
  assert.equal(typeof cleanup, "function");
  let called = false;
  const handle = await state.start(() => { assert.ok(cleanup); return { run() { called = true; return 7; } }; });
  assert.deepEqual(await handle.completion, status(7));
  assert.equal(called, true);
  assert.ok(Object.isFrozen(handle));
});

test("handle wait retains status and removes job-number lookup", async context => {
  const state = setup(context);
  const handle = await state.start(() => ({ run: () => 7 }));
  assert.deepEqual((await state.wait([{ handle }])).outcome, status(7));
  assert.deepEqual((await state.wait([{ handle }])).outcome, status(7));
  const missing = await state.wait([{ jobId: handle.jobId }]);
  assert.deepEqual(missing.outcome, status(127));
  assert.deepEqual(missing.unknown, [{ jobId: 1 }]);
});

test("job-number wait marks notified without immediately deleting lookup", async context => {
  const state = setup(context);
  const handle = await state.start(() => ({ run: () => 7 }));
  assert.deepEqual((await state.wait([{ jobId: 1 }])).outcome, status(7));
  assert.deepEqual((await state.wait([{ jobId: 1 }])).outcome, status(7));
  assert.deepEqual((await state.waitNext()).outcome, status(127));
  assert.deepEqual((await state.wait([{ handle }])).outcome, status(7));
});

test("bare wait returns zero and forgets retained handles", async context => {
  const state = setup(context);
  const first = await state.start(() => ({ run: () => 7 }));
  const second = await state.start(() => ({ run: () => 9 }));
  assert.deepEqual((await state.wait()).outcome, status(0));
  assert.deepEqual((await state.wait([{ handle: first }, { handle: second }])).outcome, status(127));
  assert.equal(state.snapshot().length, 0);
});

test("specified wait returns last status and reports every unknown target", async context => {
  const state = setup(context);
  const first = await state.start(() => ({ run: () => 7 }));
  const second = await state.start(() => ({ run: () => 9 }));
  assert.deepEqual((await state.wait([{ handle: second }, { handle: first }])).outcome, status(7));
  const mixed = await state.wait([{ jobId: 999 }, { handle: first }]);
  assert.deepEqual(mixed.outcome, status(7));
  assert.deepEqual(mixed.unknown, [{ jobId: 999 }]);
  assert.deepEqual((await state.wait([{ handle: first }, { jobId: 999 }])).outcome, status(127));
});

test("job slots reuse the highest collected number without aliasing old handles", async context => {
  const state = setup(context);
  const first = await state.start(() => ({ run: () => 3 }));
  const second = await state.start(() => ({ run: () => 4 }));
  await state.wait([{ handle: first }]);
  const third = await state.start(() => ({ run: () => 5 }));
  assert.equal(third.jobId, 3);
  await state.wait();
  const reused = await state.start(() => ({ run: () => 9 }));
  assert.equal(reused.jobId, 1);
  assert.deepEqual((await state.wait([{ handle: first }])).outcome, status(127));
  assert.deepEqual((await state.wait([{ handle: reused }])).outcome, status(9));
  assert.notEqual(reused, second);
});

test("notified completed job is collected at the next launch", async context => {
  const state = setup(context);
  const first = await state.start(() => ({ run: () => 7 }));
  await state.wait([{ jobId: 1 }]);
  const next = await state.start(() => ({ run: () => 9 }));
  assert.equal(next.jobId, 1);
  assert.deepEqual((await state.wait([{ handle: first }])).outcome, status(7));
  assert.deepEqual((await state.wait([{ jobId: 1 }])).outcome, status(9));
});

test("next wait consumes unnotified completed jobs in job-number order", async context => {
  const state = setup(context);
  const first = await state.start(() => ({ run: () => 7 }));
  const second = await state.start(() => ({ run: () => 9 }));
  await Promise.all([first.completion, second.completion]);
  const result = await state.waitNext([{ handle: second }, { handle: first }]);
  assert.deepEqual(result.outcome, status(7)); assert.equal(result.handle, first);
  assert.deepEqual((await state.waitNext()).outcome, status(9));
  assert.deepEqual((await state.waitNext()).outcome, status(127));
  assert.deepEqual((await state.wait([{ handle: first }])).outcome, status(7));
});

test("next wait respects selection rather than an unrelated completion", async context => {
  const state = setup(context);
  const pending = deferred<number>();
  const first = await state.start(() => ({ run: () => pending.promise }));
  const second = await state.start(() => ({ run: () => 9 }));
  await second.completion;
  let done = false;
  const waiting = state.waitNext([{ handle: first }, { jobId: 999 }]).then(result => { done = true; return result; });
  await Promise.resolve(); assert.equal(done, false);
  pending.resolve(7);
  const result = await waiting;
  assert.deepEqual(result.outcome, status(7)); assert.deepEqual(result.unknown, [{ jobId: 999 }]);
  assert.deepEqual((await state.waitNext()).outcome, status(9));
});

test("concurrent next waiters cannot consume the same job twice", async context => {
  const state = setup(context);
  const pending = deferred<number>();
  await state.start(() => ({ run: () => pending.promise }));
  const first = state.waitNext(); const second = state.waitNext();
  pending.resolve(4);
  assert.deepEqual((await first).outcome, status(4));
  assert.deepEqual((await second).outcome, status(127));
});

test("wait cancellation detaches a waiter without cancelling its job", async context => {
  const state = setup(context);
  const pending = deferred<number>();
  const entered = deferred<JobTaskContext>();
  const handle = await state.start(task => ({ run() { entered.resolve(task); return pending.promise; } }));
  const controller = new AbortController();
  const waiting = state.wait([{ handle }], { signal: controller.signal });
  const reason = 0;
  const rejected = assert.rejects(waiting, error => error === reason);
  controller.abort(reason); await rejected;
  assert.equal((await entered.promise).signal.aborted, false);
  pending.resolve(8);
  assert.deepEqual((await state.wait([{ handle }])).outcome, status(8));
});

test("cancelled next wait removes subscriptions and releases waiter quota", async context => {
  const state = setup(context, { maxWaiters: 1 });
  const pending = deferred<number>();
  await state.start(() => ({ run: () => pending.promise }));
  const controller = new AbortController();
  const rejected = assert.rejects(state.waitNext(undefined, { signal: controller.signal }), error => error === false);
  controller.abort(false); await rejected;
  const waiting = state.waitNext(); pending.resolve(3);
  assert.deepEqual((await waiting).outcome, status(3));
});

test("record quota covers retained statuses and refuses before task launch", async context => {
  const state = setup(context, { maxJobs: 1 });
  const first = await state.start(() => ({ run: () => 7 })); await state.wait([{ handle: first }]);
  let called = false;
  await assert.rejects(state.start(() => { called = true; return { run: () => 0 }; }), /maxJobs/u);
  assert.equal(called, false);
  await state.wait();
  assert.deepEqual(await (await state.start(() => ({ run: () => 0 }))).completion, status(0));
});

test("pending waiter admission is bounded", async context => {
  const state = setup(context, { maxWaiters: 1 });
  const pending = deferred<number>(); const handle = await state.start(() => ({ run: () => pending.promise }));
  const waiting = state.wait([{ handle }]);
  await assert.rejects(state.waitNext(), /maxWaiters/u);
  pending.resolve(0); await waiting;
});

test("foreign handles never resolve to a same-number local job", async context => {
  const state = setup(context); const other = setup(context);
  const foreign = await other.start(() => ({ run: () => 7 })); await state.start(() => ({ run: () => 9 }));
  assert.deepEqual((await state.wait([{ handle: foreign }])).outcome, status(127));
  assert.deepEqual((await state.waitNext([{ handle: foreign }])).outcome, status(127));
});

for (const reason of [undefined, null, false, 0, ""]) test(`falsey task failure stays distinct: ${String(reason)}`, async context => {
  const state = setup(context); const handle = await state.start(() => ({ run() { throw reason; } }));
  assert.deepEqual(await handle.completion, { kind: "failure", reason });
  assert.deepEqual((await state.wait([{ handle }])).outcome, { kind: "failure", reason });
});

test("wait all drains selected tasks and preserves the first escaping failure", async context => {
  const state = setup(context); const pending = deferred<number>();
  await state.start(() => ({ run() { throw false; } })); await state.start(() => ({ run: () => pending.promise }));
  let done = false; const waiting = state.wait().then(result => { done = true; return result; });
  await Promise.resolve(); assert.equal(done, false);
  pending.resolve(9);
  assert.deepEqual((await waiting).outcome, { kind: "failure", reason: false });
});

test("wait all snapshots selection and does not erase later admission", async context => {
  const state = setup(context); const pending = deferred<number>();
  await state.start(() => ({ run: () => pending.promise })); const waiting = state.wait();
  const later = await state.start(() => ({ run: () => 8 })); pending.resolve(0); await waiting;
  assert.deepEqual((await state.wait([{ handle: later }])).outcome, status(8));
});

test("task completion waits for owned cleanup", async context => {
  const state = setup(context); const pending = deferred<void>();
  let cleaned = false;
  const handle = await state.start(task => { task.registerCleanup(async () => { await pending.promise; cleaned = true; }); return { run: () => 7 }; });
  let done = false; void handle.completion.then(() => { done = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(done, false);
  pending.resolve(); assert.deepEqual(await handle.completion, status(7)); assert.equal(cleaned, true);
});

test("close cancels, unblocks cleanup, drains pending work and is idempotent", async () => {
  const state = createJobState(); const entered = deferred<JobTaskContext>(); const pending = deferred<number>();
  let releases = 0;
  const handle = await state.start(task => { task.registerCleanup(() => { releases++; pending.resolve(0); }); return { run() { entered.resolve(task); return pending.promise; } }; });
  const task = await entered.promise;
  const closed = state.close(false); assert.equal(state.close(), closed);
  await closed; assert.equal(releases, 1); assert.equal(task.signal.aborted, true); assert.equal(task.signal.reason, false);
  assert.deepEqual(await handle.completion, { kind: "failure", reason: false });
  await assert.rejects(state.start(() => ({ run: () => 0 })), /closed/u);
  assert.throws(() => task.registerCleanup(() => {}), /closed/u);
});

test("close before deferred dispatch prevents late task acquisition", async () => {
  const state = createJobState(); let started = false;
  const starting = state.start(() => ({ run() { started = true; return 0; } }));
  const rejected = assert.rejects(starting, error => error === null);
  await state.close(null); assert.equal(started, false);
  await rejected;
});

test("close waits for opaque cooperative task settlement after cancellation", async () => {
  const state = createJobState(); const entered = deferred<void>(); const pending = deferred<number>();
  await state.start(() => ({ run() { entered.resolve(); return pending.promise; } })); await entered.promise;
  let done = false; const closing = state.close().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  pending.resolve(0); await closing;
});

test("borrowed owner abort beats task failure and does not mutate owner signal", async () => {
  const owner = new AbortController(); const state = createJobState({ signal: owner.signal });
  const entered = deferred<void>(); const pending = deferred<number>();
  const handle = await state.start(() => ({ run() { entered.resolve(); return pending.promise; } })); await entered.promise;
  const closing = state.close("local"); owner.abort(0); pending.reject(false);
  await closing; assert.equal(owner.signal.reason, 0);
  assert.deepEqual(await handle.completion, { kind: "failure", reason: 0 });
});

test("cleanup failures are observed without replacing a primary falsey task failure", async () => {
  const state = createJobState();
  const handle = await state.start(task => { task.registerCleanup(() => { throw null; }); return { run() { throw 0; } }; });
  assert.deepEqual(await handle.completion, { kind: "failure", reason: 0 });
  await assert.rejects(state.close(), error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === null);
});

test("cleanup registration has a finite per-job quota", async () => {
  const state = createJobState({ maxCleanupsPerJob: 1 }); let releases = 0;
  const handle = await state.start(task => ({ run() { task.registerCleanup(() => { releases++; }); task.registerCleanup(() => {}); return 0; } }));
  const outcome = await handle.completion;
  assert.equal(outcome.kind, "failure"); if (outcome.kind === "failure") assert.match(String(outcome.reason), /maxCleanupsPerJob/u);
  assert.equal(releases, 1); await state.close();
});

test("snapshot is immutable and cannot mutate retained state", async context => {
  const state = setup(context); const handle = await state.start(() => ({ run: () => 7 })); await handle.completion;
  const snapshot = state.snapshot();
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot[0]));
  assert.equal(snapshot[0]!.listed, true); assert.equal(snapshot[0]!.notified, false);
  assert.deepEqual(snapshot[0]!.outcome, status(7));
});

test("invalid options, statuses and excessive targets fail explicitly", async context => {
  for (const options of [{ maxJobs: 0 }, { maxJobs: 257 }, { maxWaiters: NaN }, { maxWaiters: 65 }, { maxCleanupsPerJob: 1.5 }, { maxCleanupsPerJob: 65 }]) assert.throws(() => createJobState(options), TypeError);
  assert.throws(() => createJobState({ unknown: 1 } as Parameters<typeof createJobState>[0]), TypeError);
  const state = setup(context, { maxJobs: 1 });
  const invalid = await (await state.start(() => ({ run: () => 256 }))).completion;
  assert.equal(invalid.kind, "failure");
  await assert.rejects(state.wait([{ jobId: 1 }, { jobId: 2 }]), /target/u);
  await assert.rejects(state.wait([{ jobId: -1 }]), TypeError);
});

test("preparation reserves IDs and quota before awaiting a child snapshot", async context => {
  const state = setup(context, { maxJobs: 2 });
  const release = deferred<void>();
  let parent = "before";
  let prepared = false;
  const starting = state.start(async owner => {
    owner.registerCleanup(() => {});
    await release.promise;
    const snapshot = parent;
    prepared = true;
    return { run() { assert.equal(snapshot, "before"); return 7; } };
  });
  assert.equal(prepared, false);
  assert.equal(state.snapshot()[0]!.state, "preparing");
  assert.equal(state.snapshot()[0]!.handle.jobId, 1);
  const second = await state.start(() => ({ run: () => 9 }));
  assert.equal(second.jobId, 2);
  await assert.rejects(state.start(() => { throw new Error("must not prepare"); }), /maxJobs/u);
  release.resolve();
  const first = await starting;
  parent = "after";
  assert.equal(prepared, true);
  assert.deepEqual(await first.completion, status(7));
});

test("late preparation is owned and drained before cancelling start settles", async () => {
  const state = createJobState();
  const acquire = deferred<void>();
  const acquired = deferred<void>();
  let released = 0;
  let ran = false;
  const starting = state.start(async owner => {
    owner.registerCleanup(async () => { await acquired.promise; released++; });
    await acquire.promise;
    acquired.resolve();
    return { run() { ran = true; return 0; } };
  });
  const rejected = assert.rejects(starting, error => error === false);
  let drained = false;
  const closing = state.close(false).then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  acquire.resolve();
  await closing;
  await rejected;
  assert.equal(released, 1);
  assert.equal(ran, false);
});

for (const reason of [undefined, null, false, 0, ""]) test(`preparation failure drains and releases admission: ${String(reason)}`, async context => {
  const state = setup(context, { maxJobs: 1 });
  const cleanup = deferred<void>();
  let settled = false;
  const starting = state.start(owner => { owner.registerCleanup(() => cleanup.promise); throw reason; });
  const rejected = assert.rejects(starting, error => error === reason);
  void starting.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  await assert.rejects(state.start(() => ({ run: () => 0 })), /maxJobs/u);
  cleanup.resolve(); await rejected;
  assert.equal(state.snapshot().length, 0);
  assert.deepEqual(await (await state.start(() => ({ run: () => 0 }))).completion, status(0));
});

test("natural finish joins tasks and cleanup without cancellation or status replacement", async () => {
  let ownerCleanup!: () => Promise<void>;
  const state = createJobState({ registerCleanup(callback) { ownerCleanup = callback; } });
  const pending = deferred<number>();
  const cleanup = deferred<void>();
  let owner!: JobTaskContext;
  let cleaning = false;
  const handle = await state.start(task => {
    owner = task;
    task.registerCleanup(async () => { cleaning = true; await cleanup.promise; });
    return { run: () => pending.promise };
  });
  const finishing = state.finish();
  assert.equal(state.finish(), finishing);
  assert.equal(ownerCleanup(), finishing);
  let done = false; void finishing.then(() => { done = true; });
  await assert.rejects(state.start(() => ({ run: () => 0 })), /closed/u);
  assert.equal(owner.signal.aborted, false);
  assert.equal(cleaning, false);
  assert.equal(done, false);
  pending.resolve(7);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false);
  cleanup.resolve();
  assert.equal(await finishing, undefined);
  assert.equal(owner.signal.aborted, false);
  assert.deepEqual(await handle.completion, status(7));
  assert.equal(state.close(), finishing);
  assert.equal(owner.signal.aborted, false);
});

test("natural finish admits the runner of an already-reserved preparation", async () => {
  const state = createJobState();
  const preparation = deferred<void>();
  let ran = false;
  const starting = state.start(async owner => {
    await preparation.promise;
    return { run() { assert.equal(owner.signal.aborted, false); ran = true; return 9; } };
  });
  const finishing = state.finish();
  preparation.resolve();
  assert.deepEqual(await (await starting).completion, status(9));
  await finishing;
  assert.equal(ran, true);
});

test("explicit disposal upgrades an ongoing natural drain to cancellation", async () => {
  const state = createJobState();
  const pending = deferred<number>();
  let task!: JobTaskContext;
  const handle = await state.start(owner => {
    task = owner;
    owner.registerCleanup(() => { pending.resolve(0); });
    return { run: () => pending.promise };
  });
  const finishing = state.finish();
  assert.equal(state.close(0), finishing);
  await finishing;
  assert.equal(task.signal.reason, 0);
  assert.deepEqual(await handle.completion, { kind: "failure", reason: 0 });
});

test("natural finish drains all tasks before exposing a falsey execution failure", async () => {
  const state = createJobState();
  const pending = deferred<number>();
  await state.start(() => ({ run() { throw false; } }));
  await state.start(() => ({ run: () => pending.promise }));
  let done = false;
  const finishing = state.finish();
  void finishing.then(() => { done = true; }, () => { done = true; });
  const rejected = assert.rejects(finishing, error => error === false);
  await Promise.resolve(); assert.equal(done, false);
  pending.resolve(8); await rejected;
});

test("owner cleanup cancels only when no natural finish was selected", async () => {
  let ownerCleanup!: () => Promise<void>;
  const state = createJobState({ registerCleanup(callback) { ownerCleanup = callback; } });
  const pending = deferred<number>();
  let task!: JobTaskContext;
  await state.start(owner => { task = owner; owner.registerCleanup(() => { pending.resolve(0); }); return { run: () => pending.promise }; });
  await ownerCleanup();
  assert.equal(task.signal.aborted, true);
});

test("already aborted owners reject before preparation and release their listener", async () => {
  const owner = new AbortController(); owner.abort(0);
  const state = createJobState({ signal: owner.signal });
  let called = false;
  await assert.rejects(state.start(() => { called = true; return { run: () => 0 }; }), error => error === 0);
  assert.equal(called, false);
  await state.close();
});

test("wait input snapshots cannot be mutated while jobs are pending", async context => {
  const state = setup(context); const pending = deferred<number>();
  const handle = await state.start(() => ({ run: () => pending.promise }));
  const target = { jobId: handle.jobId };
  const targets = [target];
  const waiting = state.wait(targets);
  target.jobId = 999; targets.length = 0;
  pending.resolve(8);
  assert.deepEqual((await waiting).outcome, status(8));
});

test("runner acquisition is read once inside owned preparation", async () => {
  const state = createJobState();
  let reads = 0;
  let released = 0;
  const handle = await state.start(owner => {
    owner.registerCleanup(() => { released++; });
    return { get run() { if (++reads > 1) throw false; return () => 7; } };
  });
  assert.deepEqual(await handle.completion, status(7));
  assert.equal(reads, 1);
  assert.equal(released, 1);
  await state.finish();
});

test("sparse next-wait targets reject without leaking waiter admission", async context => {
  const state = setup(context, { maxWaiters: 1 });
  await assert.rejects(state.waitNext(new Array(1)), TypeError);
  assert.deepEqual((await state.waitNext()).outcome, status(127));
});

test("owner abort upgrades natural finish and waits for the admitted writer", async () => {
  const owner = new AbortController();
  const state = createJobState({ signal: owner.signal });
  const pending = deferred<number>();
  const handle = await state.start(() => ({ run: () => pending.promise }));
  let done = false;
  const finishing = state.finish();
  void finishing.then(() => { done = true; });
  owner.abort(false);
  await Promise.resolve(); assert.equal(done, false);
  pending.resolve(7);
  await finishing;
  assert.deepEqual(await handle.completion, { kind: "failure", reason: false });
});

test("specified handle consumption affects subsequent jobspec lookup", async context => {
  const state = setup(context);
  const handle = await state.start(() => ({ run: () => 7 }));
  const result = await state.wait([{ handle }, { jobId: handle.jobId }]);
  assert.deepEqual(result.outcome, status(127));
  assert.deepEqual(result.unknown, [{ jobId: 1 }]);
});

test("cleanup-only failure keeps its exact identity through natural finish", async () => {
  const state = createJobState();
  const handle = await state.start(owner => { owner.registerCleanup(() => { throw undefined; }); return { run: () => 0 }; });
  assert.deepEqual(await handle.completion, { kind: "failure", reason: undefined });
  await assert.rejects(state.finish(), error => error === undefined);
});

test("default retained quota is 256 and wait-all permits fresh admission", async context => {
  const state = setup(context);
  for (let index = 0; index < 256; index++) await state.start(() => ({ run: () => 0 }));
  await assert.rejects(state.start(() => { throw new Error("must not acquire"); }), /maxJobs/u);
  await state.wait();
  assert.equal((await state.start(() => ({ run: () => 0 }))).jobId, 1);
});

test("empty wait argument list joins and retires the same cohort as bare wait", async context => {
  const state = setup(context);
  const pending = deferred<number>();
  const handle = await state.start(() => ({ run: () => pending.promise }));
  let done = false;
  const waiting = state.wait([]).then(result => { done = true; return result; });
  await Promise.resolve();
  const premature = done;
  pending.resolve(7);
  assert.deepEqual((await waiting).outcome, status(0));
  assert.equal(premature, false);
  assert.deepEqual((await state.wait([{ handle }])).outcome, status(127));
});

test("empty next-wait argument list considers all eligible jobs", async context => {
  const state = setup(context);
  const handle = await state.start(() => ({ run: () => 7 }));
  await handle.completion;
  assert.deepEqual((await state.waitNext([])).outcome, status(7));
});

test("an escaping task failure outranks local close after all owned work drains", async () => {
  const state = createJobState();
  const pending = deferred<number>();
  const handle = await state.start(() => ({ run: () => pending.promise }));
  const closing = state.close(0);
  pending.reject(false);
  await closing;
  assert.deepEqual(await handle.completion, { kind: "failure", reason: false });
});

test("reentrant close from a child abort listener shares one drain and first reason", async () => {
  const state = createJobState();
  const pending = deferred<number>();
  let nested: Promise<void> | undefined;
  let released = 0;
  const handle = await state.start(owner => {
    owner.signal.addEventListener("abort", () => { nested = state.close("nested"); }, { once: true });
    owner.registerCleanup(() => { released++; pending.resolve(0); });
    return { run: () => pending.promise };
  });
  const closing = state.close(false);
  assert.equal(nested, closing);
  await closing;
  assert.equal(released, 1);
  assert.deepEqual(await handle.completion, { kind: "failure", reason: false });
});

test("close starts all cleanup callbacks before joining mutually dependent tasks", async () => {
  const state = createJobState();
  const first = deferred<number>();
  const second = deferred<number>();
  const firstHandle = await state.start(owner => { owner.registerCleanup(() => { second.resolve(9); }); return { run: () => first.promise }; });
  const secondHandle = await state.start(owner => { owner.registerCleanup(() => { first.resolve(7); }); return { run: () => second.promise }; });
  await state.close(null);
  assert.deepEqual(await firstHandle.completion, { kind: "failure", reason: null });
  assert.deepEqual(await secondHandle.completion, { kind: "failure", reason: null });
});

test("wait subscriptions and the borrowed owner listener are removed after drain", async () => {
  const owner = new AbortController();
  const waiter = new AbortController();
  const state = createJobState({ signal: owner.signal });
  const pending = deferred<number>();
  const handle = await state.start(() => ({ run: () => pending.promise }));
  const waiting = state.wait([{ handle }], { signal: waiter.signal });
  assert.equal(getEventListeners(owner.signal, "abort").length, 1);
  assert.equal(getEventListeners(waiter.signal, "abort").length, 1);
  pending.resolve(7);
  await waiting;
  assert.equal(getEventListeners(waiter.signal, "abort").length, 0);
  await state.finish();
  assert.equal(getEventListeners(owner.signal, "abort").length, 0);
  assert.equal(owner.signal.aborted, false);
  assert.equal(waiter.signal.aborted, false);
});

const nativeCases = [
  ['(exit 7)& child=$!; wait "$child"; printf "%s " "$?"; wait "$child"; printf "%s " "$?"; wait %1 2>/dev/null; printf "%s\\n" "$?"', "7 7 127\n"],
  ['(exit 7)& child=$!; wait %1; printf "%s " "$?"; wait %1; printf "%s " "$?"; wait -n; printf "%s\\n" "$?"', "7 7 127\n"],
  ['(exit 7)& first=$!; (exit 9)& second=$!; wait; printf "%s " "$?"; wait "$first" 2>/dev/null; printf "%s " "$?"; wait "$second" 2>/dev/null; printf "%s\\n" "$?"', "0 127 127\n"],
  ['(exit 7)& first=$!; (exit 9)& second=$!; wait "$second" "$first"; printf "%s " "$?"; wait "$second"; printf "%s\\n" "$?"', "7 9\n"],
  ['(exit 7)& child=$!; wait 999999 "$child" 2>/dev/null; printf "%s " "$?"; wait "$child" 999999 2>/dev/null; printf "%s\\n" "$?"', "7 127\n"],
  ['(exit 7)& first=$!; (exit 9)& second=$!; while kill -0 "$first" 2>/dev/null || kill -0 "$second" 2>/dev/null; do :; done; wait -n "$second" "$first"; printf "%s " "$?"; wait -n; printf "%s " "$?"; wait -n; printf "%s\\n" "$?"', "7 9 127\n"],
  ['(exit 7)& first=$!; wait "$first"; (exit 9)& second=$!; wait %1; printf "%s " "$?"; wait "$first"; printf "%s\\n" "$?"', "9 7\n"],
] as const;
test("explicit pinned Bash 5.2.37 confirms foundation semantic decisions", nativeOptions(), () => {
  for (const [script, stdout] of nativeCases) {
    const result = runNative(script);
    assert.equal(result.status, 0); assert.equal(result.stdout.toString(), stdout); assert.equal(result.stderr.toString(), "");
  }
});

test("native EOF leaves a background child alive without replacing parent status", nativeOptions(), () => {
  const result = runNative('parent=$BASHPID; (for ((attempt=0; attempt<100000; attempt++)); do if ! kill -0 "$parent" 2>/dev/null; then printf "survived parent EOF\\n"; exit 7; fi; done; exit 90)& exit 3');
  assert.equal(result.status, 3);
  assert.equal(result.stdout.toString(), "survived parent EOF\n");
  assert.equal(result.stderr.toString(), "");
});
