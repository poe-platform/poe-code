import { expect, it } from "vitest";
import { NumericLocale } from "./numeric-locale.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget } from "./execution-budget.js";
import { parseFormatSpec } from "./format-spec.js";
import { renderIntegerRadixFormat } from "./integer-radix-format.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const text = (s: string) => new CodePointString(Uint32Array.from([...s], c => c.codePointAt(0)!));
const field = (s: string) => parseFormatSpec(text(s), 100, ">", "int", budget());
function locale(separator: string, grouping: readonly number[]) {
  return new NumericLocale({ decimalPoint: text("."), thousandsSeparator: text(separator), grouping }, budget());
}
const format = (n: bigint, spec: string, data: NumericLocale) => String.fromCodePoint(...renderIntegerRadixFormat(n, field(spec), budget(), 4300, data));
it("owns an immutable numeric locale snapshot", () => {
  const groups = [3, 2, 0], data = locale(",", groups);
  groups[0] = 1;
  expect(data.grouping.isBoundary(1, budget())).toBe(false);
  expect(Object.isFrozen(data)).toBe(true);
  expect([...data.decimalPoint]).toEqual([46]);
});
it("renders locale integer grouping without affecting other presentations", () => {
  const data = locale(",", [3, 2, 0]);
  expect(format(123456789n, "n", data)).toBe("12,34,56,789");
  expect(format(123456789n, "d", data)).toBe("123456789");
  expect(format(123456789n, "_d", data)).toBe("123_456_789");
  expect(format(123456789n, "n", locale("", []))).toBe("123456789");
});
it("counts Unicode separator points during zero padding and centering", () => {
  const data = locale("😀:", [3, 0]);
  expect(format(1234n, "08n", data)).toBe("001😀:234");
  expect(format(1234n, "*^9n", data)).toBe("*1😀:234**");
  expect(format(-1234n, "0>10n", data)).toBe("000-1😀:234");
});
it("honors stopped grouping and requires explicit locale metadata", () => {
  expect(format(123456789n, "n", locale("_", [3, 2, 127]))).toBe("1234_56_789");
  expect(() => renderIntegerRadixFormat(1n, field("n"), budget())).toThrow("locale metadata required");
  expect(() => format(1n, ".2n", locale(",", [3, 0]))).toThrow("Precision not allowed");
});
