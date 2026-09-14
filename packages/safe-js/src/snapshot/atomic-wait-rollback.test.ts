import { EventEmitter } from "node:events";
import { assert, expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { createAtomicsGlobal } from "../interp/globals/atomics.js";
import { runResources, withRunResources } from "../interp/resources.js";
import { createSharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import { isNumericTypedArray } from "../interp/typed-array.js";
import type { SandboxClosure, SandboxPromise } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

const schedule = vi.hoisted(() => ({ registrations: 0, failAt: Infinity, terminated: 0,
  terminationEntered: undefined as (() => void) | undefined,
  terminationGate: undefined as Promise<void> | undefined }));
vi.mock("node:worker_threads", () => ({ Worker: class extends EventEmitter {
  private readonly views: Array<Int32Array | BigInt64Array> = [];
  postMessage(message: { id: number; buffer: SharedArrayBuffer; offset: number; bigint: boolean; expected: number | bigint; timeout: number }) {
    const view = message.bigint ? new BigInt64Array(message.buffer, message.offset, 1)
      : new Int32Array(message.buffer, message.offset, 1);
    this.views.push(view);
    if (++schedule.registrations === schedule.failAt)
      Reflect.apply(Atomics.store, Atomics, [view, 0, message.bigint ? 1n : 1]);
    const result = Reflect.get(Atomics, "waitAsync")(view, 0, message.expected, message.timeout);
    this.emit("message", { id: message.id, kind: "registered", async: result.async,
      value: result.async ? undefined : result.value });
    if (result.async) void result.value.then((value: string) => this.emit("message", { id: message.id, kind: "settled", value }));
  }
  async terminate() {
    schedule.terminated++;
    schedule.terminationEntered?.();
    await schedule.terminationGate;
    for (const view of this.views) Reflect.apply(Atomics.notify, Atomics, [view, 0]);
    this.emit("exit", 1);
    return 1;
  }
} }));

it.each([false, true])("rolls back a partially activated queue while its owner remains live (BigInt: %s)", async bigint => {
  schedule.registrations = 0;
  schedule.failAt = Infinity;
  schedule.terminated = 0;
  schedule.terminationEntered = undefined;
  schedule.terminationGate = undefined;
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const buffer = createSharedArrayBufferStorage(16, undefined, budget);
    const view = bigint ? new BigInt64Array(buffer) : new Int32Array(buffer);
    assert(isNumericTypedArray(view));
    const waitAsync = createAtomicsGlobal(budget).waitAsync as SandboxClosure;
    const first = await waitAsync.call([view, 0, bigint ? 0n : 0]);
    const second = await waitAsync.call([view, 1, bigint ? 0n : 0]);
    const source = "return 0";
    const restored = restore(serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { second, first, view } }],
      callStack: [], pendingPromises: [], moduleBindings: {} }), { source });
    // The first restored waiter registers; the second races a native writer.
    schedule.failAt = schedule.registrations + 2;
    let release!: () => void;
    schedule.terminationGate = new Promise<void>(resolve => { release = resolve; });
    const terminating = new Promise<void>(resolve => { schedule.terminationEntered = resolve; });
    const settlements: unknown[] = [];
    const firstBinding = restored.currentScope.lookup("first");
    assert(firstBinding.found);
    const restoredFirst = (firstBinding.value as { value: SandboxPromise }).value;
    void restoredFirst.promise.then(value => { settlements.push(value); }, error => { settlements.push(error); });
    const activation = restored.activateAtomicWaits();
    let rejected = false;
    void activation.catch(() => { rejected = true; });
    await Promise.race([terminating, activation.catch(() => undefined)]);
    try {
      await Promise.resolve();
      expect(rejected).toBe(false);
      expect(runResources.getStore()!.signal.aborted).toBe(false);
    } finally { release(); }
    await expect(activation).rejects.toThrow("Concurrent shared mutation prevents atomic wait restoration");
    expect(runResources.getStore()!.signal.aborted).toBe(false);
    const viewBinding = restored.currentScope.lookup("view");
    assert(viewBinding.found);
    const restoredView = viewBinding.value as typeof view;
    expect(Reflect.apply(Atomics.notify, Atomics, [restoredView, 0])).toBe(0);
    expect(Reflect.apply(Atomics.notify, Atomics, [restoredView, 1])).toBe(0);
    expect(schedule.terminated).toBe(1);
    expect(settlements).toEqual([]);
    expect(restored.activateAtomicWaits()).toBe(activation);
    await expect(restored.activateAtomicWaits()).rejects.toThrow("Concurrent shared mutation");
    // Rollback must not terminate the unrelated worker belonging to this owner.
    expect(Reflect.apply(Atomics.notify, Atomics, [view, 0])).toBe(1);
    expect(Reflect.apply(Atomics.notify, Atomics, [view, 1])).toBe(1);
  });
  expect(schedule.terminated).toBe(2);
});
