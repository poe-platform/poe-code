import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import type { FloatPercentField } from "./float-percent-field.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
function field(code = 102, options: Partial<Omit<FloatPercentField, "flags">> = {}, flags: Partial<FloatPercentField["flags"]> = {}): FloatPercentField {
  return { code, width: 0n, precision: null, ...options, flags: { alternate: false, zero: false, left: false, space: false, sign: false, ...flags } };
}
function outputs(value: number, format: FloatPercentField): string[] {
  return [CodePointString.fromFloatPercentField(value, format, budget()), ImmutableBytes.fromFloatPercentField(value, format, budget())].map(output => String.fromCodePoint(...output));
}
it("renders all floating conversion codes into text and byte storage", () => {
  for (const [code, expected] of [[101, "-1.25e+01"], [69, "-1.25E+01"], [102, "-12.50"], [70, "-12.50"], [103, "-12"], [71, "-12"]] as const) expect(outputs(-12.5, field(code, { precision: 2n }))).toEqual([expected, expected]);
});
it("places signs before zero padding and gives plus precedence over space", () => {
  expect(outputs(1.25, field(102, { width: 10n, precision: 2n }, { sign: true, space: true, zero: true }))).toEqual(["+000001.25", "+000001.25"]);
  expect(outputs(-1.25, field(102, { width: 10n, precision: 2n }, { zero: true }))).toEqual(["-000001.25", "-000001.25"]);
  expect(outputs(1.25, field(102, { precision: 2n }, { space: true }))).toEqual([" 1.25", " 1.25"]);
});
it("left alignment overrides zero padding and width is a minimum", () => {
  expect(outputs(1.25, field(102, { width: 8n, precision: 2n }, { left: true, zero: true }))).toEqual(["1.25    ", "1.25    "]);
  expect(outputs(1.25, field(102, { width: 8n, precision: 2n }))).toEqual(["    1.25", "    1.25"]);
  expect(outputs(123.25, field(102, { width: 2n, precision: 2n }))).toEqual(["123.25", "123.25"]);
});
it("retains negative zero and the sign of values rounded to zero", () => {
  for (const value of [-0, -0.00001]) expect(outputs(value, field(102, { precision: 2n }))).toEqual(["-0.00", "-0.00"]);
});
it("pads nonfinite values with zeros but ignores NaN sign bits", () => {
  const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, 0xfff8000000000000n);
  expect(outputs(view.getFloat64(0), field(70, { width: 8n }, { zero: true, sign: true }))).toEqual(["+0000NAN", "+0000NAN"]);
  expect(outputs(-Infinity, field(102, { width: 8n }, { zero: true }))).toEqual(["-0000inf", "-0000inf"]);
});
it("preserves alternate form with width and precision", () => {
  expect(outputs(12, field(103, { width: 8n, precision: 4n }, { alternate: true, zero: true }))).toEqual(["00012.00", "00012.00"]);
  expect(outputs(12, field(102, { precision: 0n }, { alternate: true }))).toEqual(["12.", "12."]);
});
it("adopts only the final buffer and charges its storage element size", () => {
  const textMeter = budget(), bytesMeter = budget(), format = field(102, { width: 20n, precision: 2n });
  const text = CodePointString.fromFloatPercentField(1.25, format, textMeter), bytes = ImmutableBytes.fromFloatPercentField(1.25, format, bytesMeter);
  expect(textMeter.usage.allocatedBytes - bytesMeter.usage.allocatedBytes).toBe(60);
  expect(text.length).toBe(20); expect(bytes.length).toBe(20);
  expect(Object.isFrozen(text)).toBe(true); expect(Object.isFrozen(bytes)).toBe(true);
});
it("validates normalized metadata and preflights width allocation", () => {
  for (const format of [field(120), field(102, { width: -1n }), field(102, { precision: -1n })]) expect(() => outputs(1, format)).toThrow(RangeError);
  expect(() => outputs(1, field(102, { width: 1n << 100n }))).toThrow(ExecutionLimitError);
  expect(() => CodePointString.fromFloatPercentField(Infinity, field(102, { width: 1000n }), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
});
