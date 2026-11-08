import { assert, expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createWeakCollectionGlobals } from "./globals/weak-collections.js";
import { materializeFunctionProperties } from "./object-model.js";
import { isSandboxClosure, type SandboxObject } from "./values.js";
import { createWeakCollection, deleteWeakEntry, setWeakEntry, weakCollectionStates } from "./weak-collection.js";

it("unregisters deleted keys and removes finalized references", () => {
  let finalize: ((reference: object) => void) | undefined;
  const register = vi.fn(), unregister = vi.fn();
  vi.stubGlobal("FinalizationRegistry", class {
    constructor(callback: (reference: object) => void) { finalize = callback; }
    register = register;
    unregister = unregister;
  });
  try {
    const map = createWeakCollection("map"), key = {};
    setWeakEntry(map, key, 1);
    setWeakEntry(map, key, 2);
    const state = weakCollectionStates.get(map)!;
    const reference = [...state.references][0];
    expect(register).toHaveBeenCalledExactlyOnceWith(key, reference, reference);
    expect(deleteWeakEntry(map, key)).toBe(true);
    expect(unregister).toHaveBeenCalledExactlyOnceWith(reference);
    setWeakEntry(map, key, 3);
    const replacement = [...state.references][0];
    assert(finalize);
    finalize(reference);
    expect(state.references.has(replacement)).toBe(true);
    finalize(replacement);
    expect(state.references.size).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

it.each(["map", "set"] as const)("reclaims dead %s index entries before budget admission", async kind => {
  const budget = new Budget({arrayLength: 1});
  const constructors = createWeakCollectionGlobals(budget);
  const constructor = kind === "map" ? constructors.WeakMap : constructors.WeakSet;
  const prototype = materializeFunctionProperties(constructor).prototype as SandboxObject;
  const adder = prototype[kind === "map" ? "set" : "add"];
  assert(isSandboxClosure(adder));
  const collection = createWeakCollection(kind);
  const expired = {};
  setWeakEntry(collection, expired, 1);
  const state = weakCollectionStates.get(collection)!;
  const oldReference = [...state.references][0];
  vi.spyOn(oldReference, "deref").mockReturnValue(undefined);
  const live = {};
  expect(await adder.call([live, 2], {thisValue: collection, stack: []})).toBe(collection);
  expect(state.references.size).toBe(1);
  expect(state.entries.has(live)).toBe(true);
  expect(await adder.call([live, 3], {thisValue: collection, stack: []})).toBe(collection);
  await expect(async () => adder.call([{}, 4], {thisValue: collection, stack: []}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "arrayLength", current: 2, limit: 1});
  expect(state.references.size).toBe(1);
});

it("does not scan the index during ordinary below-limit insertion", async () => {
  const budget = new Budget({arrayLength: 2});
  const {WeakMap} = createWeakCollectionGlobals(budget);
  const prototype = materializeFunctionProperties(WeakMap).prototype as SandboxObject;
  const adder = prototype.set;
  assert(isSandboxClosure(adder));
  const collection = createWeakCollection("map"), key = {};
  setWeakEntry(collection, key, 1);
  const state = weakCollectionStates.get(collection)!;
  const deref = vi.spyOn([...state.references][0], "deref");
  expect(await adder.call([{}, 2], {thisValue: collection, stack: []})).toBe(collection);
  expect(deref).not.toHaveBeenCalled();
  expect(state.entries.get(key)?.value).toBe(1);
});
