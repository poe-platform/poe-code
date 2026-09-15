import { expect, it } from "vitest";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const operations = { hash: () => 1n, equal: (a: string | number, b: string | number) => a === b };
  const options = { isExactString: (key: string | number) => typeof key === "string" };
  const map = new OrderedKeyMap<string | number, number>(operations, meter, options);
  return { meter, operations, options, map };
}
it("captures each pair while reading later values and deletion holes live", () => {
  const { map } = fixture();
  map.set(0, 10); map.set(1, 20); map.set(2, 30);
  const first = map.nextDictionaryEntry(0);
  map.set(0, 99); map.delete(1); map.set(2, 88);
  expect(first).toEqual({ position: 1, key: 0, value: 10 });
  expect(map.nextDictionaryEntry(1)).toEqual({ position: 3, key: 2, value: 88 });
  expect(map.nextDictionaryEntry(3)).toBeUndefined();
  map.set(3, 40);
  expect(map.nextDictionaryEntry(3)).toEqual({ position: 4, key: 3, value: 40 });
});
it("keeps dictionary equality at its numeric position when insertion compacts entries", () => {
  const { map } = fixture(), other = map.emptyCopy(), trace: number[] = [];
  for (let i = 0; i < 5; i++) { map.set(i, i); other.set(i, i + 10); }
  expect(map.equals(other, (left, right) => {
    trace.push(left); expect(right).toBe(left + 10);
    if (left === 0) { map.delete(0); map.set(5, 5); }
    return true;
  })).toBe(false);
  expect(trace).toEqual([0, 2, 3, 4]);
});
it("tracks compaction, popitem truncation and clear/refill positions", () => {
  const { map } = fixture();
  for (let i = 0; i < 5; i++) map.set(i, i);
  map.delete(0); expect(map.popitem()).toEqual([4, 4]);
  map.set(5, 5);
  expect(map.nextDictionaryEntry(0)).toEqual({ position: 1, key: 1, value: 1 });
  map.clear(); map.set(10, 10); map.set(11, 11);
  expect(map.nextDictionaryEntry(1)).toEqual({ position: 2, key: 11, value: 11 });
});
it("uses declared key layout and presizing without rehashing during scans", () => {
  const { meter, options } = fixture();
  let hashes = 0;
  const map = new OrderedKeyMap<string | number, number>({ hash: () => { hashes++; return 1n; }, equal: (a,b) => a === b }, meter, { ...options, minimumEntries: 100, exactStrings: true });
  map.set("a", 1); map.set("b", 2); map.delete("a"); map.set(3, 3);
  const before = hashes;
  expect(map.nextDictionaryEntry(0)).toEqual({ position: 1, key: "b", value: 2 });
  expect(hashes).toBe(before);
});
it("keeps positional storage coherent through copy, update and transfer", () => {
  const { map, meter, operations, options } = fixture();
  map.set(0, 0); map.set(1, 1); map.delete(0);
  const copied = map.copy(); copied.set(2, 2);
  map.update(copied);
  expect(map.nextDictionaryEntry(1)).toEqual({ position: 2, key: 1, value: 1 });
  expect(map.nextDictionaryEntry(2)).toEqual({ position: 3, key: 2, value: 2 });
  const target = new OrderedKeyMap<string | number, number>(operations, meter, options);
  target.takeContents(map);
  expect(target.nextDictionaryEntry(1)).toEqual({ position: 2, key: 1, value: 1 });
  expect(map.nextDictionaryEntry(0)).toBeUndefined();
  map.set(9, 9);
  expect(map.nextDictionaryEntry(0)).toEqual({ position: 1, key: 9, value: 9 });
  expect(target.lookup(9)).toBeUndefined();
});
it("does not publish lookup entries when positional allocation fails", () => {
  let remaining = Infinity;
  const meter = { checkpoint(_steps = 1, bytes = 0) { if (bytes > remaining) throw new ExecutionLimitError("allocation"); remaining -= bytes; } };
  const map = new OrderedKeyMap<number, number>({ hash: () => 1n, equal: (a,b) => a === b }, meter, { isExactString: () => false });
  for (let i = 0; i < 5; i++) map.set(i, i);
  map.delete(0); remaining = 104;
  expect(() => map.set(5, 5)).toThrow(ExecutionLimitError);
  remaining = Infinity;
  expect(map.lookup(5)).toBeUndefined(); expect(map.size).toBe(4);
  expect(map.nextDictionaryEntry(0)).toEqual({ position: 2, key: 1, value: 1 });
});
it("requires an explicit dictionary layout and refuses incompatible transfers", () => {
  const { map, meter, operations } = fixture();
  const plain = new OrderedKeyMap<string | number, number>(operations, meter);
  expect(() => plain.nextDictionaryEntry(0)).toThrow("dictionary positional storage is not enabled");
  map.set(1, 1); plain.set(2, 2);
  expect(() => plain.takeContents(map)).toThrow("cannot transfer keys across dictionary layouts");
  expect(map.lookup(1)).toEqual({ value: 1 }); expect(plain.lookup(2)).toEqual({ value: 2 });
});
it("carries positional configuration through derived key collections", () => {
  const { map } = fixture();
  map.set(1, 10); map.set(2, 20); map.set(3, 30);
  const other = map.emptyCopy(); other.set(2, 200); other.set(4, 400);
  expect(map.differenceKeys(other).nextDictionaryEntry(0)).toMatchObject({ key: 1, value: 10 });
  expect(map.intersectKeys(other).nextDictionaryEntry(0)).toMatchObject({ key: 2 });
  expect(map.intersectKeysFrom(() => [2, 4].values(), 999).nextDictionaryEntry(0)).toMatchObject({ key: 2, value: 999 });
  map.intersectKeysInPlace(other);
  expect(map.nextDictionaryEntry(0)).toMatchObject({ key: 2 });
  expect(map.nextDictionaryEntry(1)).toBeUndefined();
});
it("keeps hash and positional storage synchronized at every checkpoint failure", () => {
  for (const mode of ["insert", "delete", "popitem", "clear", "transfer"] as const) for (let boundary = 0; boundary < 20; boundary++) {
    let remaining = Infinity;
    const meter = { checkpoint() { if (remaining-- === 0) throw new ExecutionLimitError("steps"); } };
    const operations = { hash: () => 1n, equal: (a: number,b: number) => a === b }, options = { isExactString: () => false };
    const map = new OrderedKeyMap<number, number>(operations, meter, options), source = map.emptyCopy();
    for (let key = 0; key < 5; key++) map.set(key, key);
    map.delete(0); source.set(9, 9); remaining = boundary;
    try {
      if (mode === "insert") map.set(5, 5);
      else if (mode === "delete") map.delete(2);
      else if (mode === "popitem") map.popitem();
      else if (mode === "clear") map.clear();
      else map.takeContents(source);
    } catch (error) { expect(error).toBeInstanceOf(ExecutionLimitError); }
    remaining = Infinity;
    for (const storage of [map, source]) {
      const positional = [];
      let position = 0, next;
      while ((next = storage.nextDictionaryEntry(position))) { positional.push([next.key, next.value]); position = next.position; }
      expect(positional).toEqual(storage.snapshot());
      for (const [key, value] of positional) expect(storage.lookup(key!)).toEqual({ value });
    }
  }
});
