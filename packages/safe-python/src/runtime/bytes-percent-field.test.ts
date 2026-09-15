import { expect, it } from "vitest";
import { bytesPercentField } from "./bytes-percent-field.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { createRuntimePercentConversionContext } from "./runtime-percent-conversion.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";
import { formatPercent } from "./percent-format-output.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import type { BoundPercentFormatEvent } from "./percent-format-bind.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const context = {
    ...createRuntimePercentConversionContext(meter),
    ...createRuntimeRepresentationContext(v, meter, { defaultRepr() { throw Error("unexpected default"); } }),
    byteString: (value: RuntimeValue) => value.kind === "bytes" ? value.value : undefined,
    byteArray: () => undefined, lookupBytes: () => undefined, bufferBytes: () => undefined
  };
  return { meter, v, context };
}
type Field = Extract<BoundPercentFormatEvent<RuntimeValue>, { kind: "conversion" }>;
function field(argument: RuntimeValue, code: string, options: Partial<Omit<Field, "flags">> = {}, flags: Partial<Field["flags"]> = {}): Field {
  return { kind: "conversion", argument, code: code.charCodeAt(0), offset: 1, width: 0n, precision: null, ...options, flags: { alternate: false, zero: false, left: false, space: false, sign: false, ...flags } };
}
const text = (value: ImmutableBytes) => String.fromCharCode(...value);
it("renders every numeric conversion through native byte buffers", () => {
  const { v, context, meter } = fixture();
  for (const [code, value, expected] of [["d", v.float(2.9), "2"], ["i", v.true, "1"], ["u", v.integer(-3), "-3"], ["o", v.integer(9), "11"], ["x", v.integer(255), "ff"], ["X", v.integer(255), "FF"], ["f", v.float(-0), "-0.000000"], ["F", v.float(Infinity), "INF"], ["e", v.integer(2), "2.000000e+00"], ["E", v.integer(2), "2.000000E+00"], ["g", v.float(2.5), "2.5"], ["G", v.float(Infinity), "INF"]] as const) expect(text(bytesPercentField(field(value, code), context, meter))).toBe(expected);
});
it("shares b/s conversion, ignores numeric flags and truncates before padding", () => {
  const { v, context, meter } = fixture(), value = v.bytes(ImmutableBytes.copyOf([0, 128, 255], meter));
  for (const code of ["b", "s"]) {
    expect(bytesPercentField(field(value, code), context, meter)).toBe(value.value);
    expect([...bytesPercentField(field(value, code, { width: 4n, precision: 2n }, { zero: true, sign: true, alternate: true }), context, meter)]).toEqual([32, 32, 0, 128]);
    expect([...bytesPercentField(field(value, code, { width: 4n, precision: 2n }, { left: true }), context, meter)]).toEqual([0, 128, 32, 32]);
    expect(() => bytesPercentField(field(v.string("x"), code), context, meter)).toThrow("%b requires a bytes-like object");
  }
});
it("makes both r and a ASCII before truncation, including surrogate escapes", () => {
  const { v, context, meter } = fixture();
  for (const code of ["r", "a"]) {
    expect(text(bytesPercentField(field(v.string("é😀\ud800"), code), context, meter))).toBe("'\\xe9\\U0001f600\\ud800'");
    expect(text(bytesPercentField(field(v.string("é"), code, { width: 5n, precision: 3n }), context, meter))).toBe("  '\\x");
  }
});
it("ignores c precision and numeric flags but retains byte range diagnostics", () => {
  const { v, context, meter } = fixture();
  expect([...bytesPercentField(field(v.integer(255), "c", { width: 3n, precision: 0n }, { zero: true, sign: true }), context, meter)]).toEqual([32, 32, 255]);
  expect(() => bytesPercentField(field(v.integer(256), "c"), context, meter)).toThrow("%c arg not in range(256)");
  expect(() => bytesPercentField(field(v.string("a"), "c"), context, meter)).toThrow("not str");
});
it("binds and assembles mixed fields with byte-specific error precedence", () => {
  const { v, context, meter } = fixture(), bytes = (s: string) => ImmutableBytes.copyOf([...s].map(c => c.charCodeAt(0)), meter);
  const output = { ...createRuntimePercentBindingContext(v, meter), convert: (event: Field) => bytesPercentField(event, context, meter) };
  expect(text(formatPercent(bytes("[%#x|%+.2f|%b|%r|%c]"), v.tuple([v.integer(255), v.float(1.25), v.bytes(bytes("hi")), v.string("é"), v.integer(65)]), output, meter))).toBe("[0xff|+1.25|hi|'\\xe9'|A]");
  expect(() => formatPercent(bytes("%q%"), v.integer(1), output, meter)).toThrow("unsupported format character 'q'");
  expect(() => formatPercent(bytes("%q"), v.tuple([]), output, meter)).toThrow("not enough arguments");
  expect(() => bytesPercentField(field(v.none, "\u0080"), context, meter)).toThrow("character argument not in range(0x110000)");
});
it("preserves guest repr failures and checks cancellation after storage inspection", () => {
  const { v, context, meter: budget } = fixture(), guest = v.cell({}), error = Error("guest repr");
  expect(() => bytesPercentField(field(guest, "r"), { ...context, lookupRepr: () => () => { throw error; } }, budget)).toThrow(error);
  let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  expect(() => bytesPercentField(field(v.string("x"), "r"), { ...context, string: value => { cancelled = true; return context.string(value); } }, meter)).toThrow(ExecutionLimitError);
});
