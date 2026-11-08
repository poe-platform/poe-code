import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createAtomicsGlobal } from "../interp/globals/atomics.js";
import { runResources, withRunResources } from "../interp/resources.js";
import { createSharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import type { SandboxClosure } from "../interp/values.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it("rejects unowned activation before registering and permits a later owned attempt", async () => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const wait = await (createAtomicsGlobal(budget).waitAsync as SandboxClosure).call([view, 0, 0]);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { view, wait } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(saved, { source });
    const restoredView = restored.currentScope.lookup("view").value as Int32Array;
    try {
      await expect(runResources.exit(() => restored.activateAtomicWaits()))
        .rejects.toThrow("Atomic wait activation requires a run resource owner");
      expect(Atomics.notify(restoredView, 0)).toBe(0);
      await withRunResources(undefined, async () => {
        await restored.activateAtomicWaits();
      });
      expect(Atomics.notify(restoredView, 0)).toBe(0);
      expect(Atomics.notify(view, 0)).toBe(1);
    } finally { Atomics.notify(restoredView, 0); }
  });
});

it("rejects activation by a different owner even after the first owner disposes", async () => {
  await withRunResources(undefined, async () => {
    const budget = new Budget();
    const view = new Int32Array(createSharedArrayBufferStorage(4, undefined, budget));
    const wait = await (createAtomicsGlobal(budget).waitAsync as SandboxClosure).call([view, 0, 0]);
    const source = "return 0";
    const restored = restore(serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "external", bindings: { view, wait } }],
      callStack: [], pendingPromises: [], moduleBindings: {} }), { source });
    await withRunResources(undefined, async () => {
      const first = restored.activateAtomicWaits();
      expect(restored.activateAtomicWaits()).toBe(first);
      await first;
    });
    await withRunResources(undefined, async () => {
      await expect(restored.activateAtomicWaits()).rejects.toThrow("Atomic wait activation belongs to another run resource owner");
    });
    expect(Atomics.notify(restored.currentScope.lookup("view").value as Int32Array, 0)).toBe(0);
    expect(Atomics.notify(view, 0)).toBe(1);
  });
});
