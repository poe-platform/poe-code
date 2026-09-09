import { expect, it } from "vitest";
import { floatFormatMagnitude } from "./float-format-magnitude.js";
import { ExecutionBudget } from "./execution-budget.js";

const meter = () => new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
const render = (value: number, type = 0, precision: bigint | null = null, alternate = false, noNegativeZero = false) => floatFormatMagnitude(value, { type, precision, alternate, noNegativeZero }, meter());
it("uses shortest representation for omitted type and precision", () => {
  expect(render(-0)).toEqual({ magnitude: "0.0", negative: true });
  expect(render(1e-5, 0, null, true)).toEqual({ magnitude: "1.e-05", negative: false });
  expect(render(1.25)).toEqual({ magnitude: "1.25", negative: false });
});
it("uses the omitted-type general threshold and retains a decimal digit", () => {
  expect(render(1, 0, 2n).magnitude).toBe("1.0");
  expect(render(10, 0, 2n).magnitude).toBe("1e+01");
  expect(render(0, 0, 0n).magnitude).toBe("0e+00");
  expect(render(1.25, 0, 2n).magnitude).toBe("1.2");
  expect(render(1, 0, 0n, true).magnitude).toBe("1.e+00");
});
it("shares fixed scientific and general rounding and scales percent first", () => {
  expect(render(1.25, 102, 1n).magnitude).toBe("1.2");
  expect(render(1234, 69, 2n).magnitude).toBe("1.23E+03");
  expect(render(1.25, 37, 2n).magnitude).toBe("125.00%");
  expect(render(Number.MAX_VALUE, 37).magnitude).toBe("inf%");
});
it("coerces negative zero only after rounding and ignores NaN signs", () => {
  expect(render(-0.0001, 102, 2n, false, true)).toEqual({ magnitude: "0.00", negative: false });
  expect(render(-0.01, 102, 2n, false, true)).toEqual({ magnitude: "0.01", negative: true });
  expect(render(-0, 37, 1n, false, true)).toEqual({ magnitude: "0.0%", negative: false });
  expect(render(-Infinity, 70, null, false, true)).toEqual({ magnitude: "INF", negative: true });
  expect(render(-NaN, 71)).toEqual({ magnitude: "NAN", negative: false });
});
it("rejects precision above C int range even for nonfinite values", () => {
  for (const value of [1, Infinity, NaN]) expect(() => render(value, 103, 2147483648n)).toThrow("precision too big");
});
