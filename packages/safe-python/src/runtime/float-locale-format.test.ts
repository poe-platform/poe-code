import { expect, it } from "vitest";
import { NumericLocale } from "./numeric-locale.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";
import { parseFormatSpec } from "./format-spec.js";
import { renderFloatFormatBuffer } from "./float-format-field.js";
import { renderComplexFormatBuffer } from "./complex-format-field.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const text = (s: string) => new CodePointString(Uint32Array.from([...s], c => c.codePointAt(0)!));
const field = (s: string) => parseFormatSpec(text(s), 0, ">", "float", budget());
const locale = (decimal: string, separator: string, grouping: readonly number[]) => new NumericLocale({ decimalPoint: text(decimal), thousandsSeparator: text(separator), grouping }, budget());
const format = (n: number, spec: string, data: NumericLocale) => String.fromCodePoint(...renderFloatFormatBuffer(n, field(spec), budget(), true, data));
it("renders locale general notation with independent decimal and grouping metadata", () => {
  expect(format(1234567.89, ".9n", locale(".", ",", [3, 2, 0]))).toBe("12,34,567.89");
  expect(format(-1234.5, "020.8n", locale(",", ".", [3, 0]))).toBe("-0.000.000.001.234,5");
  expect(format(1234567.89, ".3n", locale(",", ".", [3, 0]))).toBe("1,23e+06");
});
it("counts multi-code-point decimal marks in zero padding and centering", () => {
  const data = locale("😀:", "_", [3, 0]);
  expect(format(1234.5, "010.6n", data)).toBe("001_234😀:5");
  expect(format(1234.5, "*^10.6n", data)).toBe("*1_234😀:5*");
  expect(format(1.5, "n", locale("", "", []))).toBe("15");
});
it("localizes complex components before padding their combined representation", () => {
  const data = locale(",", ".", [3, 0]);
  expect(String.fromCodePoint(...renderComplexFormatBuffer(1234.5, 2345.6, field("*^30.8n"), budget(), data))).toBe("*******1.234,5+2.345,6j*******");
  expect(String.fromCodePoint(...renderComplexFormatBuffer(0, 2, field("n"), budget(), data))).toBe("0+2j");
});
it("leaves nonfinite and non-n presentations unchanged and requires locale data", () => {
  const data = locale(",", ".", [3, 0]);
  expect(format(-Infinity, "010n", data)).toBe("-000000inf");
  expect(format(1234.5, ".1f", data)).toBe("1234.5");
  expect(() => renderFloatFormatBuffer(1, field("n"), budget())).toThrow("locale metadata required");
});
