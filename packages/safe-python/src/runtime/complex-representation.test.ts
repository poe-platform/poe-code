import { expect, it } from "vitest";
import { complexRepresentation } from "./complex-representation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = () => new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 });
it("omits only a positive-zero real component and removes integral .0 suffixes", () => {
  expect(complexRepresentation(0, 2, budget())).toBe("2j");
  expect(complexRepresentation(0, -2, budget())).toBe("-2j");
  expect(complexRepresentation(1, 2, budget())).toBe("(1+2j)");
  expect(complexRepresentation(-1, -2, budget())).toBe("(-1-2j)");
});
it("preserves signed zeros in both components", () => {
  expect(complexRepresentation(0, 0, budget())).toBe("0j");
  expect(complexRepresentation(0, -0, budget())).toBe("-0j");
  expect(complexRepresentation(-0, 0, budget())).toBe("(-0+0j)");
  expect(complexRepresentation(-0, -0, budget())).toBe("(-0-0j)");
  expect(complexRepresentation(1, -0, budget())).toBe("(1-0j)");
});
it("uses shortest component digits and Python exponent thresholds", () => {
  expect(complexRepresentation(0.1, -1e-5, budget())).toBe("(0.1-1e-05j)");
  expect(complexRepresentation(1e16, 1e-4, budget())).toBe("(1e+16+0.0001j)");
  expect(complexRepresentation(Number.MAX_VALUE, Number.MIN_VALUE, budget())).toBe("(1.7976931348623157e+308+5e-324j)");
});
it("handles nonfinite components and ignores NaN sign bits", () => {
  const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, 0xfff8000000000000n);
  expect(complexRepresentation(NaN, -Infinity, budget())).toBe("(nan-infj)");
  expect(complexRepresentation(-Infinity, view.getFloat64(0), budget())).toBe("(-inf+nanj)");
  expect(complexRepresentation(0, view.getFloat64(0), budget())).toBe("nanj");
});
it("precharges output and observes cancellation", () => {
  expect(() => complexRepresentation(1, 2, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  const controller = new AbortController(); controller.abort();
  expect(() => complexRepresentation(1, 2, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
