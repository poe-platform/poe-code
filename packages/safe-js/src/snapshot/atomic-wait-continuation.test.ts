import { assert, expect, it, vi } from "vitest";
import { atomicWaitStates } from "../interp/atomic-wait-state.js";
import { Budget, SandboxError } from "../interp/budget.js";
import { createAtomicsGlobal } from "../interp/globals/atomics.js";
import { withRunResources } from "../interp/resources.js";
import { createSharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import type { SandboxClosure, SandboxPromise } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it("cleans up prior registrations when a later activation exceeds its budget", async () => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const waitAsync = createAtomicsGlobal(budget).waitAsync as SandboxClosure;
    const first = await waitAsync.call([view, 0, 0]);
    const second = await waitAsync.call([view, 0, 0]);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { first, second, view } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restoredBudget = new Budget();
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source, budget: restoredBudget });
    const failure = new SandboxError({budget: "dataSize", current: 3, limit: 2});
    const retain = restoredBudget.setRetainedDataUsage.bind(restoredBudget);
    const usage: number[] = [];
    const reservation = vi.spyOn(restoredBudget, "setRetainedDataUsage").mockImplementation((owner, size) => {
      usage.push(size);
      if (size === 3) throw failure;
      retain(owner, size);
    });
    try {
      await expect(withRunResources(undefined, () => restored.activateAtomicWaits())).rejects.toBe(failure);
      expect(usage).toEqual([1, 2, 3, 0]);
      expect(Atomics.notify(restored.currentScope.lookup("view").value as Int32Array, 0)).toBe(0);
      expect(Atomics.notify(view, 0)).toBe(2);
    } finally { reservation.mockRestore(); }
  });
});

it("captures elapsed timeout and preserves it while restoration is paused", async () => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const wait = await (createAtomicsGlobal(budget).waitAsync as SandboxClosure).call([view, 0, 0, 60000]);
    const promise = (wait as {value: SandboxPromise}).value;
    const timing = atomicWaitStates.get(promise);
    assert(timing?.startedAt !== undefined);
    const clock = vi.spyOn(performance, "now").mockReturnValue(timing.startedAt + 250);
    try {
      const source = "return 0";
      const saved = serialize({ source, currentAstNodeId: 1,
        scopeChain: [{ id: "external", bindings: { view, wait } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const node = Object.values(saved.heap ?? {}).find(node => node.kind === "pending-promise");
      assert(node?.kind === "pending-promise" && node.atomicWait !== undefined);
      expect(node.atomicWait.remaining).toBe(59750);
      const restored = restore(saved, { source });
      clock.mockReturnValue(timing.startedAt + 100000);
      const paused = serialize({ source, currentAstNodeId: 1,
        scopeChain: [{ id: "external", bindings: { wait: restored.currentScope.lookup("wait").value } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const pausedNode = Object.values(paused.heap ?? {}).find(node => node.kind === "pending-promise");
      assert(pausedNode?.kind === "pending-promise");
      expect(pausedNode.atomicWait?.remaining).toBe(59750);
    } finally { clock.mockRestore(); }
  });
});

it("keeps an already registered wait queued when the stored value changes", async () => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const atomics = createAtomicsGlobal(budget);
    await (atomics.waitAsync as SandboxClosure).call([view, 0, 0]);
    Atomics.store(view, 0, 1);
    // Reissuing the original arguments is not equivalent to restoring a wait.
    const reissued = await (atomics.waitAsync as SandboxClosure).call([view, 0, 0]);
    expect(reissued).toMatchObject({ async: false, value: "not-equal" });
    expect(Atomics.notify(view, 0)).toBe(1);
  });
});

it.each([false, true])("restores FIFO queues independently of heap order (BigInt: %s)", async bigint => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const buffer = createSharedArrayBufferStorage(16, undefined, budget);
    const view = bigint ? new BigInt64Array(buffer, 8, 1) : new Int32Array(buffer, 8, 1);
    const waitAsync = createAtomicsGlobal(budget).waitAsync as SandboxClosure;
    const expected = bigint ? 0n : 0;
    const first = await waitAsync.call([view, 0, expected]);
    const second = await waitAsync.call([view, 0, expected]);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { second, first, view } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    await restored.activateAtomicWaits();
    const a = (restored.currentScope.lookup("first").value as {value: SandboxPromise}).value.promise;
    const b = (restored.currentScope.lookup("second").value as {value: SandboxPromise}).value.promise;
    const restoredView = restored.currentScope.lookup("view").value as typeof view;
    expect(restoredView.byteOffset).toBe(8);
    const events: string[] = [];
    const observedA = a.then(value => { events.push("first:" + value); });
    const observedB = b.then(value => { events.push("second:" + value); });
    expect(Reflect.apply(Atomics.notify, Atomics, [restoredView, 0, 1])).toBe(1);
    await Promise.race([observedA, observedB]);
    expect(events).toEqual(["first:ok"]);
    expect(Reflect.apply(Atomics.notify, Atomics, [restoredView, 0, 1])).toBe(1);
    await Promise.all([observedA, observedB]);
    expect(events).toEqual(["first:ok", "second:ok"]);
  });
});

it.each(["negative-index", "fractional-index", "out-of-bounds", "negative-timeout", "infinite-timeout", "zero-order", "missing-view"])(
  "rejects malformed atomic continuation state: %s", async mutation => {
    await withRunResources(undefined, async () => {
      const budget = new Budget();
      const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
      const wait = await (createAtomicsGlobal(budget).waitAsync as SandboxClosure).call([view, 0, 0]);
      const source = "return 0";
      const saved = serialize({ source, currentAstNodeId: 1,
        scopeChain: [{ id: "external", bindings: { view, wait } }],
        callStack: [], pendingPromises: [], moduleBindings: {} });
      const node = Object.values(saved.heap ?? {}).find(node => node.kind === "pending-promise");
      assert(node?.kind === "pending-promise" && node.atomicWait !== undefined);
      if (mutation === "negative-index") node.atomicWait.index = -1;
      if (mutation === "fractional-index") node.atomicWait.index = 0.5;
      if (mutation === "out-of-bounds") node.atomicWait.index = 1;
      if (mutation === "negative-timeout") node.atomicWait.remaining = -1;
      if (mutation === "infinite-timeout") node.atomicWait.remaining = Infinity;
      if (mutation === "zero-order") node.atomicWait.order = 0;
      if (mutation === "missing-view") node.atomicWait.view = {kind: "undefined"};
      // Keep the direct Infinity mutation: JSON would turn it into valid null.
      expect(() => restore(saved, { source })).toThrow(expect.objectContaining({
        name: mutation === "out-of-bounds" ? "TypeError" : "SnapshotValidationError"
      }));
      expect(Atomics.notify(view, 0)).toBe(1);
    });
  }
);

it.each(["before", "after"])("cancels restored wait activation %s registration", async phase => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const wait = await (createAtomicsGlobal(budget).waitAsync as SandboxClosure).call([view, 0, 0]);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { view, wait } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const controller = new AbortController();
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source, signal: controller.signal });
    const reason = new Error("stop restored wait");
    await withRunResources(controller.signal, async () => {
      if (phase === "before") {
        controller.abort(reason);
        await expect(restored.activateAtomicWaits()).rejects.toBe(reason);
      } else {
        await restored.activateAtomicWaits();
        controller.abort(reason);
      }
    });
    expect(Atomics.notify(restored.currentScope.lookup("view").value as Int32Array, 0)).toBe(0);
    expect(Atomics.notify(view, 0)).toBe(1);
  });
});

it.each([0, 1])("restores a pending atomic wait after the stored value becomes %s", async stored => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const buffer = createSharedArrayBufferStorage(4, undefined, budget);
    const view = new Int32Array(buffer);
    const atomics = createAtomicsGlobal(budget);
    const wait = await (atomics.waitAsync as SandboxClosure).call([view, 0, 0]);
    Atomics.store(view, 0, stored);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { view, wait } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    let restored = restore(JSON.parse(JSON.stringify(saved)), { source });
    // A paused continuation must survive another checkpoint before activation.
    const paused = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: {
        view: restored.currentScope.lookup("view").value,
        wait: restored.currentScope.lookup("wait").value
      } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const portable = JSON.parse(JSON.stringify(paused)) as typeof paused;
    restored = restore(portable, { source });
    const serializedWait = Object.values(portable.heap ?? {}).find(node => node.kind === "pending-promise");
    assert(serializedWait?.kind === "pending-promise" && serializedWait.atomicWait !== undefined);
    serializedWait.atomicWait.index = 1;
    serializedWait.atomicWait.remaining = 0;
    await restored.activateAtomicWaits();
    await restored.activateAtomicWaits();
    const restoredView = restored.currentScope.lookup("view");
    expect(restoredView.found).toBe(true);
    expect(Atomics.notify(view, 0)).toBe(1);
    expect(Atomics.notify(restoredView.value as Int32Array, 0)).toBe(1);
    const restoredWait = restored.currentScope.lookup("wait");
    expect(restoredWait.found).toBe(true);
    expect(await (restoredWait.value as {value: SandboxPromise}).value.promise).toBe("ok");
  });
});
