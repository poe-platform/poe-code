import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const get = (receiver: RuntimeValue, name: string, budget = meter) => runtimeNativeAttribute(receiver, name, v, budget);
  return { v, get };
}

it("retains integer real/numerator identity and provides integer zero/one parts", () => {
  const { v, get } = fixture();
  for (const n of [0n, -1n, 1n << 10000n]) {
    const receiver = v.integer(n);
    expect(get(receiver, "real")).toBe(receiver); expect(get(receiver, "numerator")).toBe(receiver);
    expect(get(receiver, "imag")).toEqual(v.integer(0)); expect(get(receiver, "denominator")).toEqual(v.integer(1));
  }
});

it("returns integer rather than boolean components for bool receivers", () => {
  const { v, get } = fixture();
  for (const receiver of [v.false, v.true]) {
    for (const name of ["real", "numerator"]) expect(get(receiver, name)).toEqual(v.integer(receiver.value ? 1 : 0));
    expect(get(receiver, "imag")).toEqual(v.integer(0)); expect(get(receiver, "denominator")).toEqual(v.integer(1));
  }
});

it("retains float real identity but creates fresh positive-zero imaginary components", () => {
  const { v, get } = fixture();
  for (const value of [-0, 1, Infinity, -Infinity, NaN]) {
    const receiver = v.float(value);
    expect(get(receiver, "real")).toBe(receiver);
    const imaginary = get(receiver, "imag");
    expect(imaginary).toEqual(v.float(0)); expect(imaginary).not.toBe(get(receiver, "imag"));
  }
});

it("returns fresh complex float components preserving signed zero and non-finite values", () => {
  const { v, get } = fixture();
  for (const value of [-0, 0, 1, Infinity, -Infinity, NaN]) {
    const receiver = v.complex(value, value);
    for (const name of ["real", "imag"]) {
      const result = get(receiver, name);
      if (result.kind !== "float") throw new Error("expected float");
      expect(Object.is(result.value, value)).toBe(true); expect(result).not.toBe(get(receiver, name));
    }
  }
});

it("leaves unsupported attributes absent and checks cancellation", () => {
  const { v, get } = fixture();
  for (const receiver of [v.float(1), v.complex(1, 2)]) for (const name of ["numerator", "denominator"]) expect(() => get(receiver, name)).toThrow(`'${receiver.kind}' object has no attribute '${name}'`);
  expect(() => get(v.integer(0), "value")).toThrow("'int' object has no attribute 'value'");
  const controller = new AbortController(); controller.abort();
  expect(() => get(v.integer(0), "real", new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
