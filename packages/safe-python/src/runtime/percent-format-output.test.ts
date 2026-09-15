import { expect, it } from "vitest";
import { formatPercent, type PercentOutputContext } from "./percent-format-output.js";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const binding = createRuntimePercentBindingContext(v, meter);
  const text: PercentOutputContext<RuntimeValue, CodePointString> = { ...binding, convert(field) {
    if (field.argument.kind === "str") return field.argument.value.formatField(field.width, field.precision, field.flags.left ? "left" : "right", 32, meter);
    if (field.argument.kind === "int") return CodePointString.fromIntegerPercentField(field.argument.value, field, meter);
    throw new Error("unexpected test operand");
  } };
  const bytes: PercentOutputContext<RuntimeValue, ImmutableBytes> = { ...binding, convert(field) {
    if (field.argument.kind !== "bytes") throw new Error("unexpected test operand");
    return field.argument.value.formatField(field.width, field.precision, field.flags.left, meter);
  } };
  return { meter, v, text, bytes };
}
it("assembles literals, escapes, dynamic text fields and integer fields", () => {
  const { meter, v, text } = fixture();
  const result = formatPercent(v.string("[%*.*s] %% %#06x").value, v.tuple([v.integer(5), v.integer(2), v.string("😀abc"), v.integer(15)]), text, meter);
  expect([...result]).toEqual([...v.string("[   😀a] % 0x000f").value]);
});
it("keeps binary literals and fields as bytes without decoding", () => {
  const { meter, v, bytes } = fixture();
  const result = formatPercent(v.bytes(Uint8Array.of(255, 37, 115, 0)).value, v.bytes(Uint8Array.of(128, 0)), bytes, meter);
  expect([...result]).toEqual([255, 128, 0, 0]);
});
it("retains empty/raw storage and one-field aliases without defining guest identity", () => {
  const { meter, v, text } = fixture(), empty = v.string("").value, literal = v.string("plain").value, member = v.string("abc");
  expect(formatPercent(empty, v.tuple([]), text, meter)).toBe(empty);
  expect(formatPercent(literal, v.tuple([]), text, meter)).toBe(literal);
  expect(formatPercent(v.string("%s").value, member, text, meter)).toBe(member.value);
  expect(() => formatPercent(empty, v.integer(1), text, meter)).toThrow("not all arguments converted during string formatting");
});
it("runs each converter once and preserves ownership and source order", () => {
  const { meter, v, text } = fixture(), calls: bigint[] = [];
  const context = { ...text, convert(field: Parameters<typeof text.convert>[0]) { expect(this).toBe(context); if (field.argument.kind !== "int") throw Error("expected int"); calls.push(field.argument.value); return text.convert(field); } };
  expect([...formatPercent(v.string("%d:%d").value, v.tuple([v.integer(1), v.integer(2)]), context, meter)]).toEqual([49, 58, 50]);
  expect(calls).toEqual([1n, 2n]);
});
it("lets conversion failures precede trailing grammar and surplus failures", () => {
  const { meter, v, text } = fixture(), failure = new Error("conversion");
  const context = { ...text, convert: () => { throw failure; } };
  expect(() => formatPercent(v.string("%s%").value, v.string("x"), context, meter)).toThrow(failure);
  expect(() => formatPercent(v.string("%s").value, v.tuple([v.string("x"), v.string("y")]), context, meter)).toThrow(failure);
});
it("rejects mismatched storage from a host converter", () => {
  const { meter, v, text } = fixture();
  const context = { ...text, convert: () => v.bytes(Uint8Array.of(65)).value as never };
  expect(() => formatPercent(v.string("%s").value, v.string("x"), context, meter)).toThrow("percent converter returned incompatible storage");
});
it("checks cancellation immediately after conversion", () => {
  const { v, text } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const context = { ...text, convert: () => { cancelled = true; return v.string("x").value; } };
  expect(() => formatPercent(v.string("%s").value, v.string("x"), context, meter)).toThrow(ExecutionLimitError);
});
it("assembles many fields without repeated concatenation", () => {
  const { meter, v, text } = fixture(), member = v.string("x");
  const result = formatPercent(v.string("%s".repeat(200)).value, v.tuple(Array(200).fill(member)), text, meter);
  expect([...result]).toEqual(Array(200).fill(120));
});
