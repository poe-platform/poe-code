import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const text = (value: string) => new CodePointString(Uint32Array.from([...value], c => c.codePointAt(0)!));
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
const repr = (value: string, ascii = false) => [...text(value).repr(ascii, budget())];
const points = (value: string) => [...text(value)];

it("quotes empty and ordinary strings with single quotes", () => {
  expect(repr("")).toEqual(points("''"));
  expect(repr("hello")).toEqual(points("'hello'"));
});
it("chooses double quotes only when they avoid escaping single quotes", () => {
  expect(repr("'" )).toEqual(points('"\'"'));
  expect(repr('"')).toEqual(points("'\"'"));
  expect(repr("'\"")).toEqual([39, 92, 39, 34, 39]);
  expect(repr("'''\"")).toEqual([39, 92, 39, 92, 39, 92, 39, 34, 39]);
});
it("escapes backslash and only tab, newline and carriage return with short names", () => {
  expect(repr("\\\t\n\r\x07\b\v\f")).toEqual(points("'\\\\\\t\\n\\r\\x07\\x08\\x0b\\x0c'"));
});
it("uses lowercase fixed-width hex for nonprintable code points", () => {
  expect(repr("\0\x1f\x7f\x85\xa0\u2028\uffff\u{10ffff}")).toEqual(points("'\\x00\\x1f\\x7f\\x85\\xa0\\u2028\\uffff\\U0010ffff'"));
});
it("retains printable Unicode in repr and escapes it in ascii mode", () => {
  expect(repr("é😀中 ")).toEqual(points("'é😀中 '"));
  expect(repr("é😀中 ", true)).toEqual(points("'\\xe9\\U0001f600\\u4e2d '"));
});
it("never combines separately stored surrogates", () => {
  const source = new CodePointString(Uint32Array.of(0xd800, 0xdc00, 0x10000));
  expect([...source.repr(false, budget())]).toEqual([...points("'\\ud800\\udc00"), 0x10000, 39]);
  expect([...source.repr(true, budget())]).toEqual(points("'\\ud800\\udc00\\U00010000'"));
});
it("quotes according to the entire source including quotes at the end", () => {
  expect(repr("abc'" )).toEqual(points('"abc\'"'));
  expect(repr("abc'\"" )).toEqual(points("'abc\\'\"'"));
});
it("preflights and owns exactly one result buffer", () => {
  const source = text("'\n"), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 20 });
  const result = source.repr(false, meter);
  expect([...result]).toEqual([34, 39, 92, 110, 34]);
  expect(meter.usage.allocatedBytes).toBe(20);
  expect(Object.isFrozen(result)).toBe(true);
  expect([...source]).toEqual([39, 10]);
  expect(() => source.repr(false, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 19 }))).toThrow(ExecutionLimitError);
});
it("checks cancellation before empty output and meters scanning and filling", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => text("").repr(false, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  expect(() => text("abcdef").repr(false, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
  expect(() => text("abcdef").repr(false, new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
});
