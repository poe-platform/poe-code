import type { Budget } from "./budget.js";
import type { SandboxMap, SandboxSet, SandboxValue } from "./values.js";

declare const collectionIteratorBrand: unique symbol;
export type SandboxCollectionIterator = {
  readonly [collectionIteratorBrand]: true;
};
export type CollectionIterationMethod = "keys" | "values" | "entries";
export type CollectionIteratorSnapshot = {
  collection: SandboxMap | SandboxSet | undefined;
  collectionKind: "map" | "set";
  method: CollectionIterationMethod;
  index: number;
  exhausted: boolean;
};
type IteratorState = Omit<CollectionIteratorSnapshot, "index"> & {
  iterator: Iterator<SandboxValue> | undefined;
};
const states = new WeakMap<object, IteratorState>();

export function isSandboxCollectionIterator(value: unknown): value is SandboxCollectionIterator {
  return typeof value === "object" && value !== null && states.has(value);
}

export function createSandboxCollectionIterator(
  collection: SandboxMap | SandboxSet,
  method: CollectionIterationMethod
): SandboxCollectionIterator {
  return restoreSandboxCollectionIterator({ collection, collectionKind: collection.kind, method, index: 0, exhausted: false });
}

// A registered placeholder lets snapshot readers resolve collection/iterator cycles.
// Initialize its cursor only after the source collection has been fully restored.
export function restoreSandboxCollectionIterator(
  snapshot: CollectionIteratorSnapshot,
  target: SandboxCollectionIterator = Object.create(null) as SandboxCollectionIterator
): SandboxCollectionIterator {
  const { collection, collectionKind, method, index, exhausted } = snapshot;
  if (collection !== undefined && collection.kind !== collectionKind)
    throw new TypeError("Collection iterator source has the wrong brand.");
  if (!exhausted && collection === undefined)
    throw new TypeError("Live collection iterator requires its source collection.");
  const iterator = exhausted ? undefined : nativeIterator(collection!, method);
  for (let skipped = 0; skipped < index; skipped += 1) {
    if (iterator === undefined || iterator.next().done)
      throw new TypeError("Collection iterator cursor exceeds its source.");
  }
  states.set(target, { collection: exhausted ? undefined : collection, collectionKind, method, exhausted, iterator });
  return target;
}

export function collectionIteratorState(value: SandboxCollectionIterator): Readonly<IteratorState> {
  const state = states.get(value);
  if (state === undefined) throw new TypeError("Expected a collection iterator.");
  return state;
}

export function snapshotCollectionIterator(value: SandboxCollectionIterator): CollectionIteratorSnapshot {
  const state = collectionIteratorState(value);
  if (state.exhausted) return { ...state, index: 0 };
  const collection = state.collection!;
  const size = collection.kind === "map" ? collection.entries.size : collection.values.size;
  let remaining = 0;
  while (!state.iterator!.next().done) remaining += 1;
  const snapshot = { ...state, index: size - remaining };
  restoreSandboxCollectionIterator(snapshot, value);
  return snapshot;
}

export function nextCollectionIterator(
  value: SandboxCollectionIterator,
  budget?: Budget
): { value: SandboxValue; done: boolean } {
  const state = states.get(value)!;
  budget?.visitNode();
  if (state.exhausted) return { value: undefined, done: true };
  const result = state.iterator!.next();
  if (result.done) {
    state.exhausted = true;
    state.collection = undefined;
    state.iterator = undefined;
    return { value: undefined, done: true };
  }
  if (state.method === "entries") budget?.allocateArrayLength(2);
  return { value: result.value, done: false };
}

function nativeIterator(collection: SandboxMap | SandboxSet, method: CollectionIterationMethod): Iterator<SandboxValue> {
  return collection.kind === "map" ? collection.entries[method]() : collection.values[method]();
}
