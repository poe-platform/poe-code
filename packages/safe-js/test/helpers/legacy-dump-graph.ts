import { expect } from "vitest";
import { wellKnownSymbols } from "../../src/interp/symbols.js";

type RecordValue = Record<string, unknown>;

// Compare everything represented by the legacy format. V2 intrinsic descriptors
// have no legacy counterpart; callers validate the full new envelope separately.
// Heap IDs are allocation details, but their one-to-one alias relation is not.
export function expectLegacyDumpGraph(actual: RecordValue, legacy: RecordValue, additionalIntrinsicBindings: readonly string[] = []): void {
  const actualHeap = actual.heap as Record<string, RecordValue>;
  const legacyHeap = legacy.heap as Record<string, RecordValue>;
  const forward = new Map<number, number>();
  const reverse = new Map<number, number>();
  const inlineArrayReferences = new Set<number>();

  function compare(value: unknown, expected: unknown, path: string[]): void {
    if (expected === null || typeof expected !== "object") {
      expect(value, path.join(".")).toStrictEqual(expected);
      return;
    }
    const old = expected as RecordValue;
    const current = value as RecordValue | null;
    if (!Array.isArray(expected) && old.kind === "ref") {
      expect(current).toMatchObject({ kind: "ref", id: expect.any(Number) });
      const before = old.id as number;
      const after = current!.id as number;
      expect(inlineArrayReferences.has(after)).toBe(false);
      if (forward.has(before)) { expect(after).toBe(forward.get(before)); return; }
      expect(reverse.has(after)).toBe(false);
      forward.set(before, after);
      reverse.set(after, before);
      compare(actualHeap[after], legacyHeap[before], path);
      return;
    }
    if (current?.kind === "ref") {
      const node = actualHeap[current.id as number];
      if (node?.kind === "guest-array" && Array.isArray(expected)) {
        const id = current.id as number;
        expect(inlineArrayReferences.has(id) || reverse.has(id)).toBe(false);
        inlineArrayReferences.add(id);
        const state = node.state as {
          prototype: { kind: string; id: number };
          properties: { extensible: boolean; properties: Array<[string, RecordValue]> };
        };
        expect(state.prototype).toMatchObject({ kind: "ref", id: expect.any(Number) });
        expect(actualHeap[state.prototype.id]).toMatchObject({ kind: "intrinsic", id: '["Array","prototype"]' });
        expect(state.properties.extensible).toBe(true);
        const entries = state.properties.properties;
        expect(entries.map(([key]) => key)).toEqual(Object.getOwnPropertyNames(expected));
        for (const [key, descriptor] of entries) {
          expect(descriptor).toMatchObject({ kind: "data", writable: true,
            enumerable: key !== "length", configurable: key !== "length" });
          compare(descriptor.value, (expected as unknown as RecordValue)[key], [...path, key]);
        }
        return;
      }
      expect(node?.kind).toBe("intrinsic");
      if (old.kind === "fn" && path.length === 1 && (path[0] === "parseInt" || path[0] === "parseFloat")) {
        // The legacy inline format did not represent these required aliases.
        // Accept their canonical Number path only with exact shared heap identity.
        const number = bindings.Number as { kind: string; id: number };
        expect(number).toMatchObject({ kind: "ref", id: expect.any(Number) });
        const numberNode = actualHeap[number.id];
        expect(numberNode).toMatchObject({ kind: "intrinsic", id: '["Number"]' });
        const state = numberNode.state as { properties: { properties: Array<[unknown, RecordValue]> } };
        const descriptor = state.properties.properties.find(([key]) => key === path[0])?.[1];
        expect(descriptor?.kind).toBe("data");
        expect(descriptor?.value).toStrictEqual(current);
        expect(node.id).toBe(JSON.stringify(["Number", path[0]]));
      } else expect(node.id).toBe(JSON.stringify(path));
      if (old.kind === "fn") {
        expect(old.name).toBe(path.at(-1));
        return;
      }
      const state = node.state as { properties: { properties: Array<[unknown, RecordValue]> } };
      expect(state).toBeDefined();
      const entries = state.properties.properties.map(([key, descriptor]): [PropertyKey, RecordValue] => {
        if (typeof key === "string") return [key, descriptor];
        expect(key).toMatchObject({kind:"ref",id:expect.any(Number)});
        const symbol = actualHeap[(key as {id:number}).id];
        expect(symbol.kind).toBe("symbol");
        expect(Object.hasOwn(wellKnownSymbols, String(symbol.wellKnown))).toBe(true);
        expect(Object.keys(symbol).sort()).toEqual(["kind","wellKnown"]);
        return [wellKnownSymbols[symbol.wellKnown as keyof typeof wellKnownSymbols], descriptor];
      });
      // The old object comparison did not constrain built-in key order, and
      // explicitly added intrinsics need not be appended by the new writer.
      const expectedKeys = Reflect.ownKeys(old);
      expect(entries).toHaveLength(expectedKeys.length);
      expect(new Set(entries.map(([key]) => key))).toEqual(new Set(expectedKeys));
      for (const [key, descriptor] of entries) {
        expect(descriptor.kind).toBe("data");
        compare(descriptor.value, (old as Record<PropertyKey,unknown>)[key], [...path, String(key)]);
      }
      return;
    }
    if (Array.isArray(expected)) {
      expect(Array.isArray(value)).toBe(true);
      expect((value as unknown[]).length).toBe(expected.length);
      expected.forEach((entry, index) => compare((value as unknown[])[index], entry, [...path, String(index)]));
      return;
    }
    expect(current).not.toBeNull();
    expect(typeof current).toBe("object");
    expect(Object.keys(current!)).toEqual(Object.keys(old));
    for (const [key, entry] of Object.entries(old)) compare(current![key], entry, [...path, key]);
  }

  const bindings = actual.bindings as RecordValue;
  const oldBindings = legacy.bindings as RecordValue;
  expect(Object.keys(bindings).sort()).toEqual([...Object.keys(oldBindings), ...additionalIntrinsicBindings].sort());
  for (const name of additionalIntrinsicBindings) {
    expect(Object.hasOwn(oldBindings, name)).toBe(false);
    const reference = bindings[name] as {kind:string;id:number};
    expect(reference).toEqual({kind:"ref",id:expect.any(Number)});
    expect(actualHeap[reference.id]).toMatchObject({kind:"intrinsic",id:JSON.stringify([name])});
  }
  for (const [key, value] of Object.entries(oldBindings)) compare(bindings[key], value, [key]);
  expect(forward.size).toBe(Object.keys(legacyHeap ?? {}).length);
}
