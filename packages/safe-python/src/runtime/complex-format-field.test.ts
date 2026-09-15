import { expect, it } from "vitest";
import { renderComplexFormatBuffer } from "./complex-format-field.js";
import { parseFormatSpec } from "./format-spec.js";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const field = (spec: string) => parseFormatSpec(new CodePointString(Uint32Array.from([...spec], c => c.codePointAt(0)!)), 0, ">", "complex", budget());
const format = (real: number, imaginary: number, spec: string) => String.fromCodePoint(...renderComplexFormatBuffer(real, imaginary, field(spec), budget()));
it("uses complex omitted-type component spelling and parentheses", () => {
  expect(format(1, 2, "#")).toBe("(1.+2.j)");
  expect(format(10, 20, ".2")).toBe("(10+20j)");
  expect(format(0, 2, "+")).toBe("+2j");
  expect(format(-0, 2, "z.2")).toBe("(0+2j)");
});
it("formats both explicit-type components and rounds signs before composition", () => {
  expect(format(0, 2, ".2f")).toBe("0.00+2.00j");
  expect(format(-0.001, -0.001, "z.2f")).toBe("0.00+0.00j");
  expect(format(1, 2, " .2f")).toBe(" 1.00+2.00j");
});
it("groups each component separately and pads the combined number", () => {
  expect(format(1234.56789, 2345.67891, "*^30,.6_f")).toBe("*1,234.567_890+2,345.678_910j*");
  expect(format(1, 2, "😀^9")).toBe("😀(1+2j)😀😀");
});
it("orders precision, zero-fill and equals-alignment errors", () => {
  expect(() => format(1, 2, "0=.2147483648f")).toThrow("precision too big");
  expect(() => format(1, 2, "0=2f")).toThrow("Zero padding is not allowed in complex format specifier");
  expect(() => format(1, 2, "=2f")).toThrow("'=' alignment flag is not allowed in complex format specifier");
});
it("preflights final padding and checks cancellation", () => {
  expect(() => renderComplexFormatBuffer(1, 2, field("999999999999f"), budget())).toThrow(ExecutionLimitError);
  const controller = new AbortController(); controller.abort();
  expect(() => renderComplexFormatBuffer(1, 2, field("f"), new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
