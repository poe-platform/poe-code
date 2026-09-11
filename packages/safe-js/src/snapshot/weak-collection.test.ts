import { expect, it } from "vitest";
import { createWeakCollection, setWeakEntry, weakCollectionStates } from "../interp/weak-collection.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { run } from "../run.js";

const source = "return 0";
function snapshot(bindings: Record<string, unknown>) {
  return serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: bindings as Record<string, RuntimeSnapshotValue> }], callStack: [], pendingPromises: [], moduleBindings: {} });
}

it("omits entries whose keys are only weakly reachable", () => {
  const map = createWeakCollection("map"), key = Object.create(null);
  setWeakEntry(map, key, "not-in-snapshot");
  const saved = snapshot({ map });
  expect(JSON.stringify(saved)).not.toContain("not-in-snapshot");
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("map");
  expect(binding.found).toBe(true);
  expect(weakCollectionStates.get(binding.value as object)?.references.size).toBe(0);
});

it("preserves a rooted key, entry value and custom self-cycle", () => {
  const map = createWeakCollection("map"), key = Object.create(null);
  map.self = map;
  setWeakEntry(map, key, { back: key });
  const restored = restore(JSON.parse(JSON.stringify(snapshot({ map,key }))), { source });
  const result = restored.currentScope.lookup("map").value as Record<string, unknown>;
  const restoredKey = restored.currentScope.lookup("key").value as object;
  expect(result.self).toBe(result);
  expect(weakCollectionStates.get(result)?.entries.get(restoredKey)?.value).toEqual({ back: restoredKey });
});

it("retains chained ephemerons regardless of root order", () => {
  const first = createWeakCollection("map"), second = createWeakCollection("map");
  const a = Object.create(null), b = Object.create(null);
  setWeakEntry(first, a, b);
  setWeakEntry(second, b, "reached");
  const restored = restore(JSON.parse(JSON.stringify(snapshot({ second,first,a }))), { source });
  const firstState = weakCollectionStates.get(restored.currentScope.lookup("first").value as object);
  const secondState = weakCollectionStates.get(restored.currentScope.lookup("second").value as object);
  const key = restored.currentScope.lookup("a").value as object;
  const nextKey = firstState?.entries.get(key)?.value as object;
  expect(secondState?.entries.get(nextKey)?.value).toBe("reached");
});

it("restores weak set membership only for rooted keys", () => {
  const set = createWeakCollection("set"), key = Object.create(null), hidden = Object.create(null);
  setWeakEntry(set, key, undefined);
  setWeakEntry(set, hidden, undefined);
  const restored = restore(JSON.parse(JSON.stringify(snapshot({ set,key }))), { source });
  const state = weakCollectionStates.get(restored.currentScope.lookup("set").value as object)!;
  expect(state.entries.has(restored.currentScope.lookup("key").value as object)).toBe(true);
  expect(state.references.size).toBe(1);
});

it.each(["value", "property"])("preserves a weak symbol reachable as a %s", mode => {
  const map = createWeakCollection("map"), key = Symbol("key");
  setWeakEntry(map, key, "reached");
  const bindings = mode === "value" ? { map,key } : { map,holder: {[key]: true} };
  const restored = restore(JSON.parse(JSON.stringify(snapshot(bindings))), { source });
  const state = weakCollectionStates.get(restored.currentScope.lookup("map").value as object)!;
  const restoredKey = mode === "value" ? restored.currentScope.lookup("key").value as symbol
    : Object.getOwnPropertySymbols(restored.currentScope.lookup("holder").value as object)[0]!;
  expect(state.entries.get(restoredKey)?.value).toBe("reached");
});

it.each(["kind", "primitive", "duplicate", "arity", "setValue", "extra"])("rejects forged weak collection %s", alteration => {
  const map = createWeakCollection("map"), key = Object.create(null);
  setWeakEntry(map, key, 7);
  const saved = JSON.parse(JSON.stringify(snapshot({ map,key })));
  const node = (Object.values(saved.heap) as Array<{ kind: string; collectionKind: string; entries: unknown[][]; extra?: number }>).find(node => node.kind === "guest-weakcollection")!;
  if (alteration === "kind") node.collectionKind = "other";
  if (alteration === "primitive") node.entries[0]![0] = 1;
  if (alteration === "duplicate") node.entries.push([...node.entries[0]!]);
  if (alteration === "arity") node.entries[0]!.push(8);
  if (alteration === "setValue") node.collectionKind = "set";
  if (alteration === "extra") node.extra = 1;
  expect(() => restore(saved, { source })).toThrow();
});

it("rejects a forged registered-symbol weak key before registry hydration", async () => {
  const result = await run("return [Symbol,Symbol.for('registered')]");
  if (!result.ok) throw result.error;
  const [constructor,key] = result.returnValue as unknown[];
  const map = createWeakCollection("map");
  const saved = JSON.parse(JSON.stringify(snapshot({ map,key,Symbol:constructor })));
  const node = (Object.values(saved.heap) as Array<{ kind: string; entries: unknown[][] }>).find(node => node.kind === "guest-weakcollection")!;
  node.entries.push([saved.scopeChain[0].bindings.key,7]);
  expect(() => restore(saved, { source })).toThrow();
});
