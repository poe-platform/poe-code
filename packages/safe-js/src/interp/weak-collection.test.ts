import { expect, it } from "vitest";
import { createWeakCollection, deleteWeakEntry, setWeakEntry, weakCollectionStates } from "./weak-collection.js";
import { measureSandboxData } from "./values.js";

it("updates and deletes weak entries without growing the key index", () => {
  const map = createWeakCollection("map");
  const key = Object.create(null);
  setWeakEntry(map, key, "first");
  setWeakEntry(map, key, "second");
  const state = weakCollectionStates.get(map)!;
  expect(state.entries).toBeInstanceOf(WeakMap);
  expect(state.references.size).toBe(1);
  expect([...state.references][0]).toBeInstanceOf(WeakRef);
  expect(state.entries.get(key)?.value).toBe("second");
  expect(deleteWeakEntry(map, key)).toBe(true);
  expect(deleteWeakEntry(map, key)).toBe(false);
  expect(state.references.size).toBe(0);
});

it("charges an entry only when both owner and key are reachable", () => {
  const map = createWeakCollection("map");
  const key = Object.create(null);
  setWeakEntry(map, key, "x".repeat(200));
  expect(measureSandboxData([map])).toBe(1);
  expect(measureSandboxData([key])).toBe(1);
  expect(measureSandboxData([map,key])).toBe(203);
  expect(measureSandboxData([key,map])).toBe(203);
});

it("activates chained entries regardless of root order", () => {
  const first = createWeakCollection("map"), second = createWeakCollection("map");
  const a = Object.create(null), b = Object.create(null);
  setWeakEntry(first, a, b);
  setWeakEntry(second, b, "x".repeat(200));
  expect(measureSandboxData([first,second])).toBe(2);
  expect(measureSandboxData([second,first,a])).toBe(206);
});

it("does not activate a self-sustaining weak cycle", () => {
  const map = createWeakCollection("map");
  const a = Object.create(null), b = Object.create(null);
  setWeakEntry(map, a, b);
  setWeakEntry(map, b, a);
  expect(measureSandboxData([map])).toBe(1);
  expect(measureSandboxData([map,a])).toBe(5);
});

it("charges reachable weak-set membership without retaining its key", () => {
  const set = createWeakCollection("set");
  const key = Object.create(null);
  setWeakEntry(set, key, undefined);
  expect(measureSandboxData([set])).toBe(1);
  expect(measureSandboxData([set,key])).toBe(3);
});

it("remeasures mutable values and keeps ordinary own-property accounting", () => {
  const map = createWeakCollection("map");
  const key = Object.create(null);
  const value = { text: "abc" };
  setWeakEntry(map, key, value);
  const before = measureSandboxData([map,key]);
  value.text += "def";
  expect(measureSandboxData([map,key])).toBe(before + 3);
  map.extra = key;
  expect(measureSandboxData([map])).toBe(measureSandboxData([map,key]));
});

it("discovers a collection reachable only as a weak value", () => {
  const first = createWeakCollection("map"), second = createWeakCollection("map");
  const a = Object.create(null), b = Object.create(null);
  setWeakEntry(first, a, second);
  setWeakEntry(second, b, "abc");
  expect(measureSandboxData([first,a,b])).toBe(9);
  expect(measureSandboxData([first,b])).toBe(2);
});

it("activates every owner waiting on the same key exactly once", () => {
  const first = createWeakCollection("map"), second = createWeakCollection("map");
  const key = Object.create(null);
  setWeakEntry(first, key, "abc");
  setWeakEntry(second, key, "def");
  expect(measureSandboxData([first,second,key,key])).toBe(11);
});

it("does not deduplicate equal primitive values from distinct weak entries", () => {
  const map = createWeakCollection("map");
  const a = Object.create(null), b = Object.create(null);
  setWeakEntry(map, a, "abc");
  setWeakEntry(map, b, "abc");
  expect(measureSandboxData([map,a,b])).toBe(11);
});

it("activates a weak symbol key from an independent symbol root", () => {
  const map = createWeakCollection("map"), key = Symbol("key");
  // The native Node 22 backing store accepts symbols; guest accounting must
  // still distinguish a live symbol root from a weak-only association.
  setWeakEntry(map, key, "abc");
  expect(measureSandboxData([map])).toBe(1);
  expect(measureSandboxData([map,key])).toBe(9);
  expect(measureSandboxData([key,map])).toBe(9);
});

it("activates a weak symbol key retained by an ordinary property key", () => {
  const map = createWeakCollection("map"), key = Symbol("key");
  setWeakEntry(map, key, "abc");
  expect(measureSandboxData([map,{[key]: true}])).toBe(11);
});
