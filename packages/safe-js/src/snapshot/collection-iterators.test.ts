import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { assertSandboxGraphDepth, assertSnapshotGraphDepth, MAX_DATA_DEPTH } from "../graph-depth.js";
import { setSandboxPrototype } from "../interp/object-model.js";
import { collectionIteratorState, createSandboxCollectionIterator, isSandboxCollectionIterator, nextCollectionIterator } from "../interp/collection-iterator.js";
import { getSandboxIterator } from "../interp/iteration.js";
import { cloneSandboxValue, createSandboxMap, createSandboxSet, isSandboxMap, type SandboxObject, type SandboxValue } from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

function roundTrip(graph: SandboxObject, format: "snapshot" | "replay" | "clone"): SandboxObject {
  if (format === "clone") return cloneSandboxValue(graph) as SandboxObject;
  if (format === "replay") return decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(graph)))) as SandboxObject;
  const source = "await task()";
  const snapshot = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { graph } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source, budget: new Budget() }).currentScope.lookup("graph");
  expect(binding.found).toBe(true);
  if (!binding.found) throw new Error("Restored graph missing");
  return binding.value as SandboxObject;
}

describe.each(["snapshot", "replay", "clone"] as const)("collection iterator %s data", format => {
  it.each(["map", "set"] as const)("retains %s aliases, a live cursor, and source identity", kind => {
    const collection = kind === "map" ? createSandboxMap([["a", 1], ["b", 2], ["c", 3]]) : createSandboxSet(["a", "b", "c"]);
    const iterator = createSandboxCollectionIterator(collection, "keys");
    expect(nextCollectionIterator(iterator)).toEqual({ value: "a", done: false });
    if (isSandboxMap(collection)) collection.entries.delete("a");
    else collection.values.delete("a");
    const graph = roundTrip({ iterator, collection, alias: iterator }, format);
    expect(isSandboxCollectionIterator(graph.iterator)).toBe(true);
    if (!isSandboxCollectionIterator(graph.iterator)) throw new Error("Iterator brand lost");
    expect(graph.alias).toBe(graph.iterator);
    expect(collectionIteratorState(graph.iterator).collection).toBe(graph.collection);
    const restoredCollection = collectionIteratorState(graph.iterator).collection!;
    if (isSandboxMap(restoredCollection)) restoredCollection.entries.set("d", 4);
    else restoredCollection.values.add("d");
    const actual: SandboxValue[] = [];
    const reader = getSandboxIterator(graph.iterator)!;
    for (let next = reader.next() as IteratorResult<SandboxValue>; !next.done; next = reader.next() as IteratorResult<SandboxValue>) actual.push(next.value);
    expect(actual).toEqual(["b", "c", "d"]);
    expect(nextCollectionIterator(iterator)).toEqual({ value: "b", done: false });
  });

  it.each(["keys", "values", "entries"] as const)("preserves Map %s mode", method => {
    const iterator = createSandboxCollectionIterator(createSandboxMap([["a", 1], ["b", 2]]), method);
    nextCollectionIterator(iterator);
    const graph = roundTrip({ iterator }, format);
    expect(isSandboxCollectionIterator(graph.iterator)).toBe(true);
    if (!isSandboxCollectionIterator(graph.iterator)) throw new Error("Iterator brand lost");
    expect(nextCollectionIterator(graph.iterator)).toEqual({ value: method === "keys" ? "b" : method === "values" ? 2 : ["b", 2], done: false });
  });

  it.each(["map", "set"] as const)("preserves %s collection/iterator cycles", kind => {
    const collection = kind === "map" ? createSandboxMap() : createSandboxSet();
    const iterator = createSandboxCollectionIterator(collection, "values");
    if (isSandboxMap(collection)) collection.entries.set("iterator", iterator);
    else collection.values.add(iterator);
    const graph = roundTrip({ collection, iterator }, format);
    expect(isSandboxCollectionIterator(graph.iterator)).toBe(true);
    if (!isSandboxCollectionIterator(graph.iterator)) throw new Error("Iterator brand lost");
    expect(nextCollectionIterator(graph.iterator)).toEqual({ value: graph.iterator, done: false });
  });

  it.each([false, true])("preserves exhaustion=%s after later insertion", exhausted => {
    const collection = createSandboxSet([1]);
    const iterator = createSandboxCollectionIterator(collection, "values");
    nextCollectionIterator(iterator);
    if (exhausted) nextCollectionIterator(iterator);
    const graph = roundTrip({ iterator, collection }, format);
    expect(isSandboxCollectionIterator(graph.iterator)).toBe(true);
    if (!isSandboxCollectionIterator(graph.iterator)) throw new Error("Iterator brand lost");
    const restoredCollection = graph.collection as typeof collection;
    restoredCollection.values.add(2);
    expect(nextCollectionIterator(graph.iterator)).toEqual(exhausted ? { value: undefined, done: true } : { value: 2, done: false });
  });

  it("preserves ordinary iterator properties and shared values", () => {
    const shared = { label: "shared" };
    const collection = createSandboxSet([shared]);
    const iterator = createSandboxCollectionIterator(collection, "values");
    Object.assign(iterator, { note: shared });
    const graph = roundTrip({ iterator, shared }, format);
    expect(isSandboxCollectionIterator(graph.iterator)).toBe(true);
    if (!isSandboxCollectionIterator(graph.iterator)) throw new Error("Iterator brand lost");
    expect((graph.iterator as unknown as SandboxObject).note).toBe(graph.shared);
    expect(nextCollectionIterator(graph.iterator).value).toBe(graph.shared);
  });

  it("keeps the existing custom-prototype copy boundary", () => {
    const iterator = createSandboxCollectionIterator(createSandboxSet([1]), "values");
    setSandboxPrototype(iterator, { tag: "custom" }, new Budget());
    expect(() => roundTrip({ iterator }, format)).toThrow(/prototype|descriptor/);
  });
});

describe("collection iterator graph depth", () => {
  it.each(["map", "set"] as const)("follows hidden %s sources", kind => {
    let value: SandboxValue = undefined;
    for (let depth = 0; depth <= MAX_DATA_DEPTH / 2; depth += 1) {
      const source = kind === "map" ? createSandboxMap([["nested", value]]) : createSandboxSet([value]);
      value = createSandboxCollectionIterator(source, "values");
    }
    expect(() => assertSandboxGraphDepth(value)).toThrowError(expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" }));
    expect(() => assertSnapshotGraphDepth(value)).toThrowError(expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" }));
  });

  it("accepts bounded cyclic sources", () => {
    const source = createSandboxMap();
    const iterator = createSandboxCollectionIterator(source, "values");
    source.entries.set("self", iterator);
    expect(() => assertSandboxGraphDepth(iterator)).not.toThrow();
    expect(() => assertSnapshotGraphDepth(iterator)).not.toThrow();
  });
});

describe.each(["snapshot", "replay"] as const)("collection iterator %s validation", format => {
  it.each([
    ["collectionKind", "object"], ["collectionKind", "map"], ["method", "next"],
    ["index", -1], ["index", 0.5], ["index", 2], ["exhausted", "yes"]
  ])("rejects malformed %s=%s", (field, value) => {
    const iterator = createSandboxCollectionIterator(createSandboxSet([1]), "values");
    if (format === "replay") {
      const data = JSON.parse(JSON.stringify(encodeReplayData({ iterator })));
      const node = data.nodes.find((entry: { kind: string }) => entry.kind === "collection-iterator");
      node[field] = value;
      expect(() => decodeReplayData(data)).toThrow();
    } else {
      const source = "await task()";
      const data = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { iterator } }], callStack: [], pendingPromises: [], moduleBindings: {} })));
      const node = Object.values(data.heap).find(entry => (entry as { kind: string }).kind === "collection-iterator") as Record<string, unknown>;
      node[field as string] = value;
      expect(() => restore(data, { source, budget: new Budget() })).toThrow();
    }
  });
});
