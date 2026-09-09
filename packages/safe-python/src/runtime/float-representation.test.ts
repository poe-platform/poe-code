import { expect, it } from "vitest";
import { floatRepresentation } from "./float-representation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
it("renders shortest round-trip decimal digits", () => {
  for (const [value, expected] of [[0.1, "0.1"], [1.2345678901234567, "1.2345678901234567"], [2.675, "2.675"], [-1.25, "-1.25"], [1.0000000000000002, "1.0000000000000002"]] as const) expect(floatRepresentation(value, budget())).toBe(expected);
});
it("uses Python's fixed/scientific notation thresholds", () => {
  for (const [value, expected] of [[1e-5, "1e-05"], [1e-4, "0.0001"], [1e15, "1000000000000000.0"], [1e16, "1e+16"], [1e20, "1e+20"], [1e21, "1e+21"]] as const) expect(floatRepresentation(value, budget())).toBe(expected);
});
it("normalizes integer-looking host output without changing its significant digits", () => {
  expect(floatRepresentation(1000000000000000100, budget())).toBe("1.0000000000000001e+18");
  expect(floatRepresentation(123456789012345680000, budget())).toBe("1.2345678901234568e+20");
  expect(floatRepresentation(12, budget())).toBe("12.0");
});
it("preserves negative zero and spells nonfinite values in lowercase", () => {
  expect(floatRepresentation(0, budget())).toBe("0.0");
  expect(floatRepresentation(-0, budget())).toBe("-0.0");
  expect(floatRepresentation(Infinity, budget())).toBe("inf");
  expect(floatRepresentation(-Infinity, budget())).toBe("-inf");
  expect(floatRepresentation(NaN, budget())).toBe("nan");
});
it("renders the full binary64 range without losing subnormals", () => {
  expect(floatRepresentation(Number.MIN_VALUE, budget())).toBe("5e-324");
  expect(floatRepresentation(Number.MAX_VALUE, budget())).toBe("1.7976931348623157e+308");
  expect(floatRepresentation(2.2250738585072014e-308, budget())).toBe("2.2250738585072014e-308");
});
it("reserves bounded output work and observes cancellation", () => {
  expect(() => floatRepresentation(1.25, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  const controller = new AbortController(); controller.abort();
  expect(() => floatRepresentation(1.25, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
