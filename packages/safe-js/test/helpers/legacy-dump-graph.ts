import { expect } from "vitest";

type RecordValue = Record<string, unknown>;

// Compare everything represented by the legacy format. V2 intrinsic descriptors
// have no legacy counterpart; callers validate the full new envelope separately.
// Heap IDs are allocation details, but their one-to-one alias relation is not.
export function expectLegacyDumpGraph(actual: RecordValue, legacy: RecordValue): void {
  const actualHeap = actual.heap as Record<string, RecordValue>;
  const legacyHeap = legacy.heap as Record<string, RecordValue>;
  const forward = new Map<number, number>();
  const reverse = new Map<number, number>();

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
      if (forward.has(before)) { expect(after).toBe(forward.get(before)); return; }
      expect(reverse.has(after)).toBe(false);
      forward.set(before, after);
      reverse.set(after, before);
      compare(actualHeap[after], legacyHeap[before], path);
      return;
    }
    if (current?.kind === "ref") {
      const node = actualHeap[current.id as number];
      expect(node?.kind).toBe("intrinsic");
      expect(node.id).toBe(JSON.stringify(path));
      if (old.kind === "fn") {
        expect(old.name).toBe(path.at(-1));
        return;
      }
      const state = node.state as { properties: { properties: Array<[unknown, RecordValue]> } };
      expect(state).toBeDefined();
      const entries = state.properties.properties;
      // The old object comparison did not constrain built-in key order, and
      // explicitly added intrinsics need not be appended by the new writer.
      expect(entries.map(([key]) => key).sort()).toEqual(Object.keys(old).sort());
      for (const [key, descriptor] of entries) {
        expect(descriptor.kind).toBe("data");
        compare(descriptor.value, old[key as string], [...path, key as string]);
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
  expect(Object.keys(bindings).sort()).toEqual(Object.keys(oldBindings).sort());
  for (const [key, value] of Object.entries(oldBindings)) compare(bindings[key], value, [key]);
  expect(forward.size).toBe(Object.keys(legacyHeap ?? {}).length);
}
