import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
const bytes = (values: number[]) => ImmutableBytes.copyOf(values, budget());
const points = (value: string) => [...value].map(c => c.codePointAt(0)!);
const repr = (values: number[]) => [...CodePointString.fromBytesRepr(bytes(values), budget())];

it("prefixes empty and printable byte representations with b", () => {
  expect(repr([])).toEqual(points("b''"));
  expect(repr([97, 98, 99])).toEqual(points("b'abc'"));
});
it("selects quotes using Python's whole-input rule", () => {
  expect(repr([39])).toEqual([98, 34, 39, 34]);
  expect(repr([34])).toEqual([98, 39, 34, 39]);
  expect(repr([39, 39, 34])).toEqual([98, 39, 92, 39, 92, 39, 34, 39]);
});
it("escapes backslash, tab, newline and carriage return", () => {
  expect(repr([92, 9, 10, 13])).toEqual(points("b'\\\\\\t\\n\\r'"));
});
it("uses two-digit hex escapes for other controls and every high byte", () => {
  expect(repr([0, 7, 8, 11, 12, 31, 127, 128, 160, 233, 255])).toEqual(points("b'\\x00\\x07\\x08\\x0b\\x0c\\x1f\\x7f\\x80\\xa0\\xe9\\xff'"));
});
it("does not decode multibyte sequences", () => {
  expect(repr([0xf0, 0x9f, 0x98, 0x80])).toEqual(points("b'\\xf0\\x9f\\x98\\x80'"));
});
it("owns and charges just the final code-point buffer", () => {
  const source = bytes([39, 10]), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 24 });
  const result = CodePointString.fromBytesRepr(source, meter);
  expect([...result]).toEqual([98, 34, 39, 92, 110, 34]);
  expect(meter.usage.allocatedBytes).toBe(24);
  expect(Object.isFrozen(result)).toBe(true);
  expect([...source]).toEqual([39, 10]);
  expect(() => CodePointString.fromBytesRepr(source, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 23 }))).toThrow(ExecutionLimitError);
});
it("checks cancellation for empty bytes and meters both scans", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => CodePointString.fromBytesRepr(bytes([]), new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  for (const maxSteps of [5, 10]) expect(() => CodePointString.fromBytesRepr(bytes([97, 98, 99, 100, 101, 102]), new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
});
