import { expect, it } from "vitest";
import { DictionaryEntrySlots } from "./dictionary-entry-slots.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
it("retains reserved insertion capacity across early deletion holes", () => {
  const slots = new DictionaryEntrySlots<object>(budget(), 6), entries = Array.from({length: 11}, () => ({}));
  for (const entry of entries.slice(0, 5)) slots.append(entry);
  slots.delete(entries[0]!);
  slots.append(entries[5]!);
  expect(slots.next(0)).toEqual({ position: 2, entry: entries[1] });
  for (const entry of entries.slice(6, 10)) slots.append(entry);
  expect(slots.next(0)).toEqual({ position: 2, entry: entries[1] });
  slots.append(entries[10]!);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[1] });
});
it("ignores requested layout for tiny reservations but selects it for larger ones", () => {
  for (const minimum of [0, 1, 5, 6]) {
    const slots = new DictionaryEntrySlots<object>(budget(), minimum, false), a = {}, b = {}, c = {};
    slots.append(a, true); slots.append(b, true); slots.delete(a); slots.append(c, false);
    expect(slots.next(0)).toEqual({ position: minimum <= 5 ? 1 : 2, entry: b });
  }
});
it("converts a presized exact-string layout when adding a general key", () => {
  const slots = new DictionaryEntrySlots<object>(budget(), 100, true), a = {}, b = {}, c = {};
  slots.append(a, true); slots.append(b, true); slots.delete(a); slots.append(c, false);
  expect(slots.next(0)).toEqual({ position: 1, entry: b });
});
it("caps large reservation hints instead of allocating proportional to the hint", () => {
  const small = budget(), huge = budget();
  new DictionaryEntrySlots<object>(small, 87381);
  new DictionaryEntrySlots<object>(huge, Number.MAX_SAFE_INTEGER);
  expect(huge.usage).toEqual(small.usage);
  expect(huge.usage.allocatedBytes).toBe(96 + 87381 * 8);
});
it("clear discards reserved capacity and layout", () => {
  const slots = new DictionaryEntrySlots<object>(budget(), 100, false), entries = Array.from({length: 6}, () => ({}));
  slots.clear();
  for (const entry of entries.slice(0, 5)) slots.append(entry);
  slots.delete(entries[0]!); slots.append(entries[5]!);
  expect(slots.next(0)).toEqual({ position: 1, entry: entries[1] });
});
it("validates hints and charges reserved slots before publication", () => {
  for (const hint of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => new DictionaryEntrySlots<object>(budget(), hint)).toThrow(RangeError);
  const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 100 });
  expect(() => new DictionaryEntrySlots<object>(meter, 100)).toThrow(ExecutionLimitError);
});
