import { expect, it } from "vitest";
import { textPercentField } from "./text-percent-field.js";
import { createRuntimePercentConversionContext } from "./runtime-percent-conversion.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";
import { formatPercent } from "./percent-format-output.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import type { BoundPercentFormatEvent } from "./percent-format-bind.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = { ...createRuntimePercentConversionContext(meter), ...createRuntimeRepresentationContext(v, meter, { defaultRepr: () => { throw Error("unexpected default"); } }) };
  return { meter, v, context };
}
type Field = Extract<BoundPercentFormatEvent<RuntimeValue>, { kind: "conversion" }>;
function field(argument: RuntimeValue, code: string, options: Partial<Omit<Field, "flags">> = {}, flags: Partial<Field["flags"]> = {}): Field {
  return { kind: "conversion", argument, code: code.charCodeAt(0), offset: 1, width: 0n, precision: null, ...options, flags: { alternate: false, zero: false, left: false, space: false, sign: false, ...flags } };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("dispatches integer and float codes through their conversion and rendering rules", () => {
  const { v, context, meter } = fixture();
  for (const [code, value, expected] of [["d", v.float(2.9), "2"], ["i", v.true, "1"], ["u", v.integer(-3), "-3"], ["o", v.integer(9), "11"], ["x", v.integer(255), "ff"], ["X", v.integer(255), "FF"], ["f", v.float(-0), "-0.000000"], ["E", v.integer(2), "2.000000E+00"], ["g", v.float(2.5), "2.5"]] as const) expect(text(textPercentField(field(value, code), context, meter))).toBe(expected);
});
it("keeps unmodified representation result identity despite ignored numeric flags", () => {
  const { v, context, meter } = fixture(), value = v.string("hello");
  expect(textPercentField(field(value, "s", { width: 2n, precision: 10n }, { sign: true, zero: true, alternate: true }), context, meter)).toBe(value);
  expect(text(textPercentField(field(value, "s", { width: 5n, precision: 2n }, { zero: true }), context, meter))).toBe("   he");
});
it("converts repr and ascii before applying code-point precision", () => {
  const { v, context, meter } = fixture(), value = v.string("é😀");
  expect(text(textPercentField(field(value, "r", { precision: 3n }), context, meter))).toBe("'é😀");
  expect(text(textPercentField(field(value, "a", { precision: 2n }), context, meter))).toBe("'\\");
});
it("ignores character precision and numeric flags but applies space width", () => {
  const { v, context, meter } = fixture();
  expect(text(textPercentField(field(v.integer(0x1f600), "c", { width: 3n, precision: 0n }, { zero: true, sign: true }), context, meter))).toBe("  😀");
  expect(text(textPercentField(field(v.string("é"), "c", { width: 3n }, { left: true }), context, meter))).toBe("é  ");
});
it("rejects unsupported codes and invalid conversion operands", () => {
  const { v, context, meter } = fixture();
  expect(() => textPercentField(field(v.integer(1), "b", { offset: 3 }), context, meter)).toThrow("unsupported format character 'b' (0x62) at index 3");
  expect(() => textPercentField(field(v.float(2.5), "x"), context, meter)).toThrow("%x format: an integer is required, not float");
});
it("assembles mixed fields with binding and conversion error precedence", () => {
  const { v, context, meter } = fixture();
  const outputContext = { ...createRuntimePercentBindingContext(v, meter), convert: (event: Field) => {
    const value = textPercentField(event, context, meter);
    if (value.kind !== "str") throw Error("expected str"); return value.value;
  } };
  const result = formatPercent(v.string("[%#x|%+.2f|%s|%r|%a|%c]").value, v.tuple([v.integer(255), v.float(1.25), v.string("é"), v.true, v.string("é"), v.integer(65)]), outputContext, meter);
  expect(String.fromCodePoint(...result)).toBe("[0xff|+1.25|é|True|'\\xe9'|A]");
  expect(() => formatPercent(v.string("%q%").value, v.integer(1), outputContext, meter)).toThrow("unsupported format character 'q'");
  expect(() => formatPercent(v.string("%q").value, v.tuple([]), outputContext, meter)).toThrow("not enough arguments");
});
it("checks cancellation after result construction", () => {
  const { v, context } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  context.stringPoints = storage => { cancelled = true; return v.stringPoints(storage); };
  expect(() => textPercentField(field(v.integer(1), "d"), context, meter)).toThrow(ExecutionLimitError);
});
