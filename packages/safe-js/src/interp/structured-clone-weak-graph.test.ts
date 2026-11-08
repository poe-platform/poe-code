import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { cloneStructuredGraph, createSandboxClosure, type SandboxObject } from "./values.js";
import { createWeakCollection } from "./weak-collection.js";
import { createWeakReferenceState, weakReferenceStates } from "./weak-reference.js";
import { FinalizationRegistryState, finalizationRegistryStates } from "./finalization-registry-state.js";

it.each(["map", "set", "reference", "finalization"] as const)(
  "rejects private weak %s state before yielding property reads", kind => {
    const value: SandboxObject = kind === "map" || kind === "set"
      ? createWeakCollection(kind) : Object.create(null);
    const registry = kind === "finalization"
      ? new FinalizationRegistryState(async () => undefined, () => undefined) : undefined;
    if (kind === "reference") weakReferenceStates.set(value, createWeakReferenceState({}));
    if (registry !== undefined) finalizationRegistryStates.set(value, {
      state: registry, callback: createSandboxClosure({ name: "cleanup", call: () => undefined })
    });
    let reads = 0;
    try {
      for (const accessor of [false, true]) {
        if (accessor) Object.defineProperty(value, "label", {
          enumerable: true, get() { reads++; throw new Error("must not run"); }
        });
        for (const input of [value, { value }, [value]]) {
          const graph = cloneStructuredGraph(input, { seen: new WeakMap() }, new Budget());
          expect(() => graph.next()).toThrow(expect.objectContaining({ name: "DataCloneError" }));
        }
      }
      expect(reads).toBe(0);
    } finally {
      registry?.dispose();
    }
  }
);

it("still clones unbranded null-prototype records and preserves cycles", () => {
  const value = Object.assign(Object.create(null), { answer: 42 });
  value.self = value;
  const graph = cloneStructuredGraph(value, { seen: new WeakMap() }, new Budget());
  const result = graph.next();
  expect(result.done).toBe(true);
  const copy = result.value as SandboxObject;
  expect(copy).not.toBe(value);
  expect(copy.self).toBe(copy);
  expect(copy.answer).toBe(42);
});
