import { expect, it } from "vitest";
import { createWeakCollection, setWeakEntry, weakCollectionStates } from "../interp/weak-collection.js";
import { FinalizationRegistryState, finalizationRegistryStates } from "../interp/finalization-registry-state.js";
import { withRunResources } from "../interp/resources.js";
import { isSandboxClosure } from "../interp/values.js";
import { run } from "../run.js";
import { restore } from "./restore.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";

const source = "return () => 0";

function save(bindings: Record<string, RuntimeSnapshotValue>) {
  return serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings }], callStack: [], pendingPromises: [], moduleBindings: {} });
}

it.each(["object", "symbol"] as const)("does not root a cycle of %s ephemeron keys through its values", kind => {
  const a = kind === "object" ? {} : Symbol("a");
  const b = kind === "object" ? {} : Symbol("b");
  const first = createWeakCollection("map"), second = createWeakCollection("map");
  setWeakEntry(first, a, { next: b, marker: "unrooted-first" });
  setWeakEntry(second, b, { next: a, marker: "unrooted-second" });
  const saved = save({ first, second });
  expect(JSON.stringify(saved)).not.toContain("unrooted-first");
  expect(JSON.stringify(saved)).not.toContain("unrooted-second");
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  for (const name of ["first", "second"]) {
    const state = weakCollectionStates.get(restored.currentScope.lookup(name).value as object)!;
    expect(state.references.size).toBe(0);
  }
});

it.each(["object", "symbol"] as const)("closes a rooted %s ephemeron cycle and preserves shared values", kind => {
  const a = kind === "object" ? {} : Symbol("a");
  const b = kind === "object" ? {} : Symbol("b");
  const first = createWeakCollection("map"), second = createWeakCollection("map");
  const shared = { a, b };
  setWeakEntry(first, a, shared);
  setWeakEntry(second, b, shared);
  const restored = restore(JSON.parse(JSON.stringify(save({ second, first, a }))), { source });
  const firstState = weakCollectionStates.get(restored.currentScope.lookup("first").value as object)!;
  const secondState = weakCollectionStates.get(restored.currentScope.lookup("second").value as object)!;
  const restoredA = restored.currentScope.lookup("a").value as object | symbol;
  const value = firstState.entries.get(restoredA)!.value as typeof shared;
  expect(value.a).toBe(restoredA);
  expect(secondState.entries.get(value.b)!.value).toBe(value);
  expect(firstState.references.size).toBe(1);
  expect(secondState.references.size).toBe(1);
});

it("uses a held value as an ephemeron root while preserving target and token aliases", async () => {
  const result = await run(source);
  if (!result.ok || !isSandboxClosure(result.returnValue)) throw new Error("Missing cleanup callback.");
  const registry = Object.create(null);
  const state = new FinalizationRegistryState(async () => {}, () => {});
  finalizationRegistryStates.set(registry, { state, callback: result.returnValue });
  const key = {}, target = {}, token = {};
  const map = createWeakCollection("map");
  const held = { key };
  setWeakEntry(map, key, { target, token, held });
  state.register(target, held, token);
  try {
    const saved = save({ map, registry });
    await withRunResources(undefined, async () => {
      const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
      const restoredRegistry = finalizationRegistryStates.get(restored.currentScope.lookup("registry").value as object)!.state;
      const [cell] = restoredRegistry.cells;
      const restoredHeld = cell!.heldValue as typeof held;
      const restoredMap = weakCollectionStates.get(restored.currentScope.lookup("map").value as object)!;
      const value = restoredMap.entries.get(restoredHeld.key)!.value as { target: object; token: object; held: typeof held };
      expect(value.held).toBe(restoredHeld);
      expect(cell!.target.deref()).toBe(value.target);
      expect(cell!.token!.deref()).toBe(value.token);
      expect(restoredRegistry.unregister(value.token)).toBe(true);
      expect(cell!.heldValue).toBeUndefined();
      expect(restoredMap.entries.get(restoredHeld.key)!.value).toBe(value);
    });
  } finally { state.dispose(); }
});
