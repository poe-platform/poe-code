import { expect, it } from "vitest";
import { DictionaryEntrySlots } from "./dictionary-entry-slots.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  const slots = new DictionaryEntrySlots<{ key: number; value: number }>(meter);
  const entries = Array.from({ length: 12 }, (_,key) => ({ key, value: key }));
  return { meter, slots, entries };
}
it("traverses live entries by numeric position and leaves deletion holes", () => {
  const { slots, entries } = fixture();
  for (const entry of entries.slice(0, 4)) slots.append(entry);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[0] });
  slots.delete(entries[1]!); entries[2]!.value = 99;
  expect(slots.next(1)).toEqual({ position: 3, entry: entries[2] });
  expect(slots.next(3)).toEqual({ position: 4, entry: entries[3] });
  expect(slots.next(4)).toBeUndefined();
  slots.append(entries[4]!);
  expect(slots.next(4)).toEqual({ position: 5, entry: entries[4] });
});
it("compacts only when insertion capacity is exhausted", () => {
  const { slots, entries } = fixture();
  for (const entry of entries.slice(0, 5)) slots.append(entry);
  slots.delete(entries[0]!); slots.delete(entries[1]!);
  expect(slots.next(0)).toEqual({ position: 3, entry: entries[2] });
  slots.append(entries[5]!);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[2] });
  expect(slots.next(3)).toEqual({ position: 4, entry: entries[5] });
});
it("preserves a caller's numeric position after clear and refill", () => {
  const { slots, entries } = fixture();
  slots.append(entries[0]!); slots.append(entries[1]!);
  const position = slots.next(0)!.position;
  slots.clear(); slots.append(entries[2]!); slots.append(entries[3]!);
  expect(slots.next(position)).toEqual({ position: 2, entry: entries[3] });
});
it("pop trims trailing holes but does not refund insertion capacity", () => {
  const { slots, entries } = fixture();
  for (const entry of entries.slice(0, 5)) slots.append(entry);
  slots.delete(entries[4]!); slots.delete(entries[0]!);
  expect(slots.pop()).toBe(entries[3]);
  expect(slots.next(3)).toBeUndefined();
  slots.append(entries[5]!);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[1] });
  expect(slots.next(2)).toEqual({ position: 3, entry: entries[5] });
});
it("keeps entry identity and rejects duplicate live entries", () => {
  const { slots, entries } = fixture();
  slots.append(entries[0]!);
  expect(() => slots.append(entries[0]!)).toThrow("entry is already present");
  expect(slots.delete(entries[1]!)).toBe(false);
  expect(slots.delete(entries[0]!)).toBe(true);
  slots.append(entries[0]!);
  expect(slots.next(0)).toEqual({ position: 2, entry: entries[0] });
  expect(slots.pop()).toBe(entries[0]);
  expect(slots.pop()).toBeUndefined();
});
it("precharges compaction atomically and validates cursor positions", () => {
  let reject = false;
  const meter = { checkpoint(_steps = 1, bytes = 0) { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } };
  const slots = new DictionaryEntrySlots<object>(meter), entries = Array.from({length: 6}, () => ({}));
  for (const entry of entries.slice(0, 5)) slots.append(entry);
  slots.delete(entries[0]!); reject = true;
  expect(() => slots.append(entries[5]!)).toThrow(ExecutionLimitError);
  reject = false;
  expect(slots.next(0)).toEqual({ position: 2, entry: entries[1] });
  for (const position of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => slots.next(position)).toThrow(RangeError);
  expect(slots.next(Number.MAX_SAFE_INTEGER)).toBeUndefined();
});
it("does not rescan deletion holes when pop sees no live entries", () => {
  let steps = 0;
  const slots = new DictionaryEntrySlots<object>({ checkpoint(amount = 1) { steps += amount; } });
  const entries = Array.from({ length: 80 }, () => ({}));
  for (const entry of entries) slots.append(entry);
  for (const entry of entries) slots.delete(entry);
  steps = 0;
  expect(slots.pop()).toBeUndefined();
  expect(slots.pop()).toBeUndefined();
  expect(steps).toBe(2);
});
it("compacts string-key slots on a general key before insertion capacity runs out", () => {
  const { slots, entries } = fixture();
  slots.append(entries[0]!, true); slots.append(entries[1]!, true);
  slots.delete(entries[0]!);
  slots.append(entries[2]!, false);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[1] });
  expect(slots.next(1)).toEqual({ position: 2, entry: entries[2] });
});
it("keeps layout and positions when the owner overwrites an existing key", () => {
  const { slots, entries } = fixture();
  slots.append(entries[0]!, true); slots.append(entries[1]!, true);
  slots.delete(entries[0]!);
  // Lookup/payload overwrite does not append, including a matching str subclass.
  entries[1]!.value = 99;
  expect(slots.next(0)).toEqual({ position: 2, entry: entries[1] });
  slots.append(entries[2]!, false);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[1] });
});
it("does not compact ordinary string insertion or already-general layouts", () => {
  for (const exact of [true, false]) {
    const { slots, entries } = fixture();
    slots.append(entries[0]!, exact); slots.append(entries[1]!, true);
    slots.delete(entries[0]!);
    slots.append(entries[2]!, true);
    expect(slots.next(0)).toEqual({ position: 2, entry: entries[1] });
  }
});
it("retains general layout after deletion but resets it on clear", () => {
  const { slots, entries } = fixture();
  slots.append(entries[0]!, false); slots.delete(entries[0]!);
  slots.append(entries[1]!, true); slots.append(entries[2]!, false);
  expect(slots.next(0)).toEqual({ position: 2, entry: entries[1] });
  slots.clear();
  slots.append(entries[3]!, true); slots.append(entries[4]!, true); slots.delete(entries[3]!);
  slots.append(entries[5]!, false);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[4] });
});
it("precharges layout conversion before changing positions or layout state", () => {
  let reject = false;
  const slots = new DictionaryEntrySlots<object>({ checkpoint(_steps = 1, bytes = 0) { if (reject && bytes > 0) throw new ExecutionLimitError("allocation"); } });
  const a = {}, b = {}, c = {};
  slots.append(a, true); slots.append(b, true); slots.delete(a);
  reject = true;
  expect(() => slots.append(c, false)).toThrow(ExecutionLimitError);
  reject = false;
  expect(slots.next(0)).toEqual({ position: 2, entry: b });
  slots.append(c, false);
  expect(slots.next(0)).toEqual({ position: 1, entry: b });
});
