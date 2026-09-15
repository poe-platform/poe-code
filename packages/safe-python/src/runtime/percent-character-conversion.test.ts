import { expect, it } from "vitest";
import { percentCharacter, type PercentCharacterContext } from "./percent-character-conversion.js";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface Value { name: string; integer?: bigint; exact?: boolean; string?: CodePointString; bytes?: { kind: "bytes" | "bytearray"; value: ImmutableBytes }; index?: () => Value }
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 });
const integer = (value: bigint): Value => ({ name: "int", integer: value, exact: true });
function fixture() {
  const warnings: string[] = [];
  const context: PercentCharacterContext<Value> = {
    integer: value => value.integer, isExactInteger: value => value.exact === true,
    string: value => value.string, bytes: value => value.bytes, lookupIndex: value => value.index,
    typeName: value => value.name, qualifiedTypeName: value => value.name, warn: (_category, message) => { warnings.push(message); }
  };
  return { context, warnings };
}
it("accepts one Python code point including astral values and surrogates", () => {
  const { context } = fixture();
  for (const point of [0, 65, 0xd800, 0x1f600, 0x10ffff]) {
    const source = { name: "str", string: new CodePointString(Uint32Array.of(point)) };
    expect(percentCharacter(source, false, context, budget())).toBe(point);
    expect(percentCharacter(integer(BigInt(point)), false, context, budget())).toBe(point);
  }
});
it("uses string length errors without combining surrogate pairs", () => {
  const { context } = fixture();
  for (const points of [[], [0xd800, 0xdc00]]) expect(() => percentCharacter({ name: "Sub", string: new CodePointString(Uint32Array.from(points)) }, false, context, budget())).toThrow(`%c requires an int or a unicode character, not a string of length ${points.length}`);
});
it("accepts only single bytes or bytearray payloads for bytes formats", () => {
  const { context } = fixture();
  for (const kind of ["bytes", "bytearray"] as const) {
    expect(percentCharacter({ name: "Sub", bytes: { kind, value: ImmutableBytes.copyOf([255], budget()) } }, true, context, budget())).toBe(255);
    expect(() => percentCharacter({ name: "Sub", bytes: { kind, value: ImmutableBytes.copyOf([], budget()) } }, true, context, budget())).toThrow(`%c requires an integer in range(256) or a single byte, not a ${kind} object of length 0`);
  }
});
it("uses index conversion and enforces text versus byte ranges", () => {
  const { context } = fixture();
  expect(percentCharacter({ name: "C", index: () => integer(65n) }, true, context, budget())).toBe(65);
  for (const bytes of [false, true]) for (const value of [-1n, 1n << 100n, bytes ? 256n : 0x110000n]) expect(() => percentCharacter(integer(value), bytes, context, budget())).toThrow(`%c arg not in range(${bytes ? "256" : "0x110000"})`);
});
it("distinguishes missing conversion from a bytes index TypeError", () => {
  const { context } = fixture(), failure = new PythonRuntimeError("TypeError", "custom");
  for (const bytes of [false, true]) expect(() => percentCharacter({ name: "float" }, bytes, context, budget())).toThrow(bytes ? "%c requires an integer in range(256) or a single byte, not float" : "%c requires an int or a unicode character, not float");
  expect(() => percentCharacter({ name: "C", index: () => { throw failure; } }, false, context, budget())).toThrow("%c requires an int or a unicode character, not C");
  expect(() => percentCharacter({ name: "C", index: () => { throw failure; } }, true, context, budget())).toThrow(failure);
});
it("warns for index subclasses and preserves non-TypeError exceptions", () => {
  const { context, warnings } = fixture(), failure = new PythonRuntimeError("OverflowError", "custom");
  expect(percentCharacter({ name: "C", index: () => ({ name: "bool", integer: 1n }) }, false, context, budget())).toBe(1);
  expect(warnings[0]).toContain("__index__ returned non-int (type bool)");
  expect(() => percentCharacter({ name: "C", index: () => { throw failure; } }, false, context, budget())).toThrow(failure);
});
it("preserves byte index invalid-result diagnostics", () => {
  const { context } = fixture(), source = { name: "C", index: () => ({ name: "str" }) };
  expect(() => percentCharacter(source, true, context, budget())).toThrow("__index__ returned non-int (type str)");
  expect(() => percentCharacter(source, false, context, budget())).toThrow("%c requires an int or a unicode character, not C");
});
it("classifies guest TypeErrors only for text and never catches fatal limits", () => {
  const { context } = fixture(), guest = {}, fatal = new ExecutionLimitError("cancelled");
  context.isTypeError = () => true;
  expect(() => percentCharacter({ name: "C", index: () => { throw guest; } }, false, context, budget())).toThrow("%c requires an int or a unicode character, not C");
  expect(() => percentCharacter({ name: "C", index: () => { throw fatal; } }, false, context, budget())).toThrow(fatal);
});
it("checks cancellation after extracting a character payload", () => {
  const { context } = fixture(); let cancelled = false;
  context.string = () => { cancelled = true; return new CodePointString(Uint32Array.of(65)); };
  expect(() => percentCharacter({ name: "str" }, false, context, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
});
it("retains full type names in character-specific diagnostics", () => {
  const { context } = fixture(), name = "€".repeat(300);
  expect(() => percentCharacter({ name }, false, context, budget())).toThrow(`%c requires an int or a unicode character, not ${name}`);
  expect(() => percentCharacter({ name }, true, context, budget())).toThrow(`%c requires an integer in range(256) or a single byte, not ${name}`);
});
it("uses qualified display names independently of index-protocol type names", () => {
  const { context } = fixture(); context.qualifiedTypeName = () => "foo.Outer.Inner";
  expect(() => percentCharacter({ name: "C" }, false, context, budget())).toThrow("not foo.Outer.Inner");
});
