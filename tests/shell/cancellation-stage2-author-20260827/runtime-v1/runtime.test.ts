import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { setImmediate as turn } from "node:timers/promises";

import { MemoryFileSystem, Shell } from "../../../../src/index.js";
import { InvocationScope } from "../../../../src/shell/cleanup.js";

const capture = <Value>(pending: Value | PromiseLike<Value>) => Promise.resolve(pending).then(
  value => ({ kind: "return" as const, value }),
  reason => ({ kind: "throw" as const, reason: reason as unknown }),
);

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

test("borrowed forms preserve the parent signal without cancellation resources", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const seen: AbortSignal[] = [];
  shell.register({ name: "leaf", execute(context) { seen.push(context.signal); return { exitCode: 3 }; } });
  shell.register({ name: "driver", async execute(context) {
    const baseline = getEventListeners(context.signal, "abort").length;
    const native = globalThis.AbortController;
    const created: number[] = [];
    globalThis.AbortController = new Proxy(native, {
      construct(target, args, receiver) {
        created[created.length - 1] = (created.at(-1) ?? 0) + 1;
        return Reflect.construct(target, args, receiver);
      },
    });
    try {
      for (const invoke of [
        () => context.invoke!("leaf", []),
        () => context.invoke!("leaf", [], undefined),
        () => context.invoke!("leaf", [], {}),
        () => context.invoke!("leaf", [], { signal: undefined }),
      ]) {
        created.push(0);
        assert.equal((await invoke()).exitCode, 3);
      }
    } finally { globalThis.AbortController = native; }
    assert.deepEqual(created, [2, 2, 2, 2]);
    assert.equal(getEventListeners(context.signal, "abort").length, baseline);
    assert.ok(seen.every(signal => signal === context.signal));
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("driver")).exitCode, 0); }
  finally { await shell.dispose(); }
});

test("admission rejects before a child scope and reads the signal getter once", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const caller = new AbortController();
  let handlerCalls = 0;
  let childScopes = 0;
  let reads = 0;
  const original = InvocationScope.prototype.child;
  InvocationScope.prototype.child = function () { childScopes++; return Reflect.apply(original, this, []); };
  shell.register({ name: "leaf", execute() { handlerCalls++; return { exitCode: 0 }; } });
  shell.register({ name: "driver", async execute(context) {
    const local = new AbortController();
    local.abort(false);
    const localOutcome = await capture(context.invoke!("leaf", [], { get signal() { reads++; return local.signal; } }));
    assert.equal(localOutcome.kind, "throw");
    assert.ok(Object.is(localOutcome.reason, false));
    assert.equal(reads, 1);
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("driver", { signal: caller.signal })).exitCode, 0);
    assert.equal(childScopes, 1, "only the existing driver dispatch scope was created");
    assert.equal(handlerCalls, 0);
  } finally {
    InvocationScope.prototype.child = original;
    await shell.dispose();
  }
});

test("local cancellation settles after cleanup, detaches, and leaves parent live", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const local = new AbortController();
  const entered = deferred();
  const work = deferred();
  const cleaning = deferred();
  const release = deferred();
  let delivered!: AbortSignal;
  let settled = false;
  shell.register({ name: "leaf", async execute(context) {
    delivered = context.signal;
    context.registerCleanup!(async () => { cleaning.resolve(); await release.promise; });
    entered.resolve();
    await work.promise;
    return { exitCode: 7 };
  } });
  shell.register({ name: "driver", async execute(context) {
    const outcome = capture(context.invoke!("leaf", [], { signal: local.signal })).then(value => { settled = true; return value; });
    await entered.promise;
    local.abort(0);
    work.resolve();
    await cleaning.promise;
    await turn();
    assert.equal(settled, false);
    assert.ok(Object.is(delivered.reason, 0));
    release.resolve();
    const selected = await outcome;
    assert.equal(selected.kind, "throw");
    assert.ok(Object.is(selected.reason, 0));
    assert.equal(context.signal.aborted, false);
    assert.equal(getEventListeners(local.signal, "abort").length, 0);
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("driver")).exitCode, 0); }
  finally { release.resolve(); work.resolve(); await shell.dispose(); }
});

test("mapped child rejection returns outer status one and does not poison the wrapper", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const local = new AbortController();
  const reason = Object.freeze({ child: true });
  shell.register({ name: "leaf", async execute(context) {
    local.abort(reason);
    context.signal.throwIfAborted();
    return { exitCode: 7 };
  } });
  shell.register({ name: "branch", async execute(context) {
    return context.invoke!("leaf", [], { signal: local.signal });
  } });
  shell.register({ name: "driver", async execute(context) {
    assert.equal((await context.invoke!("branch", [], { signal: new AbortController().signal })).exitCode, 1);
    assert.equal(context.signal.aborted, false);
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("driver")).exitCode, 0); }
  finally { await shell.dispose(); }
});

test("root caller outranks execution and exact cleanup failures at the final barrier", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const caller = new AbortController();
  const rootReason = Object.freeze({ root: true });
  shell.register({ name: "driver", execute(context) {
    context.registerCleanup!(() => { caller.abort(rootReason); throw false; });
    throw Object.freeze({ execution: true });
  } });
  try {
    const outcome = await capture(shell.exec("driver", { signal: caller.signal }));
    assert.equal(outcome.kind, "throw");
    assert.equal(outcome.reason, rootReason);
  } finally { await shell.dispose(); }
});
