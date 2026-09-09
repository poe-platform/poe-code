import { expect, it } from "vitest";
import { unsupportedPercentConversion } from "./percent-format-error.js";
import { formatPercent } from "./percent-format-output.js";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
it("reports printable ASCII codes and code-point offsets", () => {
  expect(() => unsupportedPercentConversion(113, 3, false, budget())).toThrow("unsupported format character 'q' (0x71) at index 3");
  expect(() => unsupportedPercentConversion(39, 1, false, budget())).toThrow("unsupported format character ''' (0x27) at index 1");
});
it("uses a question mark for nonprintable and non-ASCII text codes", () => {
  for (const code of [0, 9, 10, 127, 233, 0xd800, 0x1f600, 0x10ffff]) expect(() => unsupportedPercentConversion(code, 2, false, budget())).toThrow(`unsupported format character '?' (0x${code.toString(16)}) at index 2`);
});
it("retains raw ASCII control characters in bytes diagnostics", () => {
  for (const code of [0, 9, 10, 127]) expect(() => unsupportedPercentConversion(code, 1, true, budget())).toThrow(`unsupported format character '${String.fromCharCode(code)}' (0x${code.toString(16)}) at index 1`);
});
it("retains the text diagnostic's U+001F lower boundary", () => {
  expect(() => unsupportedPercentConversion(31, 1, false, budget())).toThrow("unsupported format character '\u001f' (0x1f) at index 1");
});
it("matches CPython's signed high-byte diagnostic overflow", () => {
  for (const code of [128, 200, 255]) expect(() => unsupportedPercentConversion(code, 1, true, budget())).toThrow(expect.objectContaining({ name: "OverflowError", message: "character argument not in range(0x110000)" }));
});
it("runs after operand binding, including bytes high-code failures", () => {
  const meter = budget(), v = new RuntimeValues(meter), binding = createRuntimePercentBindingContext(v, meter);
  const textContext = { ...binding, convert: (field: { code: number; offset: number }) => unsupportedPercentConversion(field.code, field.offset, false, meter) };
  const bytesContext = { ...binding, convert: (field: { code: number; offset: number }) => unsupportedPercentConversion(field.code, field.offset, true, meter) };
  expect(() => formatPercent(v.string("😀%q").value, v.integer(1), textContext, meter)).toThrow("at index 2");
  expect(() => formatPercent(v.string("%q").value, v.tuple([]), textContext, meter)).toThrow("not enough arguments for format string");
  const source = v.bytes(Uint8Array.of(37, 255)).value;
  expect(() => formatPercent(source, v.tuple([]), bytesContext, meter)).toThrow("not enough arguments for format string");
  expect(() => formatPercent(source, v.integer(1), bytesContext, meter)).toThrow("character argument not in range(0x110000)");
});
it("validates host metadata and checks cancellation before guest errors", () => {
  for (const [code, offset, bytes] of [[-1, 0, false], [0x110000, 0, false], [256, 0, true], [113, -1, false]] as const) expect(() => unsupportedPercentConversion(code, offset, bytes, budget())).toThrow(RangeError);
  const controller = new AbortController(); controller.abort();
  expect(() => unsupportedPercentConversion(113, 1, false, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
