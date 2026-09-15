import { expect, it } from "vitest";
import { renderFloatFormatBuffer } from "./float-format-field.js";
import { parseFormatSpec } from "./format-spec.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const field = (spec: string) => parseFormatSpec(new CodePointString(Uint32Array.from([...spec], c => c.codePointAt(0)!)), 0, ">", "float", budget());
const format = (value: number, spec: string) => String.fromCodePoint(...renderFloatFormatBuffer(value, field(spec), budget()));
it("groups integer and fractional digits around sign-aware padding", () => {
  expect(format(1234.56789, "020,.6_f")).toBe("0,000,001,234.567_890");
  expect(format(-1234.56789, "020_.6,f")).toBe("-000_001_234.567,890");
  expect(format(1234.56789, "0>20,.6_f")).toBe("00000001,234.567_890");
  expect(format(1.2345678, ".7_f")).toBe("1.234_567_8");
});
it("aligns code-point fills and leaves exponent and percent suffixes ungrouped", () => {
  expect(format(1234.56789, "020,.2e")).toBe("0,000,000,001.23e+03");
  expect(format(1234.56789, "020,.2%")).toBe("0,000,000,123,456.79%");
  expect(format(1.5, "😀^6")).toBe("😀1.5😀😀");
  expect(format(-1.5, "*=8.1f")).toBe("-****1.5");
});
it("pads nonfinite values without grouping padding zeroes", () => {
  expect(format(Infinity, "010,f")).toBe("0000000inf");
  expect(format(-Infinity, "010,F")).toBe("-000000INF");
  expect(format(NaN, "+010,%")).toBe("+00000nan%");
});
it("uses the rounded sign including z coercion before calculating padding", () => {
  expect(format(-0.0001, "+z08.2f")).toBe("+0000.00");
  expect(format(-0.0001, "08.2f")).toBe("-0000.00");
});
it("charges exactly one final output buffer and preflights oversized width", () => {
  const narrow = budget(), wide = budget();
  const a = renderFloatFormatBuffer(1.25, field(".2f"), narrow);
  const b = renderFloatFormatBuffer(1.25, field("100.2f"), wide);
  expect(wide.usage.allocatedBytes - narrow.usage.allocatedBytes).toBe((b.length - a.length) * 4);
  expect(() => renderFloatFormatBuffer(1, field("0999999999999,f"), budget())).toThrow(ExecutionLimitError);
});
