import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";
import { RuntimeTypeNames } from "./runtime-type-names.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new RuntimeValues(meter);
  return { meter, values, names: new RuntimeTypeNames("C", "Outer.C", meter) };
}

it("retains independent prepared names and caches reads", () => {
  const { meter, values, names } = fixture();
  expect(names.get("__name__", values, meter)).toEqual(values.string("C")); expect(names.get("__qualname__", values, meter)).toEqual(values.string("Outer.C"));
  expect(names.get("__name__", values, meter)).toBe(names.get("__name__", values, meter));
  expect(names.get("__qualname__", values, meter)).toBe(names.get("__qualname__", values, meter));
});

it.each(["__name__", "__qualname__"] as const)("preserves assigned guest identity for %s", field => {
  const { meter, values, names } = fixture(), assigned = values.string("Other.𐀀");
  names.set(field, assigned, meter); expect(names.get(field, values, meter)).toBe(assigned);
  expect(names.name).toBe(field === "__name__" ? "Other.𐀀" : "C");
});

it("rejects invalid name encodings before null checks without committing mutation", () => {
  const { meter, values, names } = fixture(), prior = names.get("__name__", values, meter);
  for (const text of ["a\ud800", "a\ud800\ud801b", "\u0000\ud800"]) {
    expect(() => names.set("__name__", values.string(text), meter)).toThrow("surrogates not allowed");
    expect(names.get("__name__", values, meter)).toBe(prior); expect(names.name).toBe("C");
  }
  expect(() => names.set("__name__", values.string("a\u0000b"), meter)).toThrow("type name must not contain null characters");
});

it("permits null and surrogate characters in qualified names", () => {
  const { meter, values, names } = fixture(), value = values.string("a\u0000\ud800b");
  names.set("__qualname__", value, meter); expect(names.get("__qualname__", values, meter)).toBe(value);
});

it.each(["__name__", "__qualname__"] as const)("rejects non-string %s without changing either name", field => {
  const { meter, values, names } = fixture();
  expect(() => names.set(field, values.integer(1), meter)).toThrow(`can only assign string to C.${field}, not 'int'`);
  expect(names.name).toBe("C"); expect(names.get("__qualname__", values, meter)).toEqual(values.string("Outer.C"));
});

it("does not commit partially decoded names when the meter aborts", () => {
  const { meter, values, names } = fixture(), prior = names.get("__name__", values, meter);
  const limited = new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 100000 });
  expect(() => names.set("__name__", values.string("new name"), limited)).toThrow();
  expect(names.get("__name__", values, meter)).toBe(prior); expect(names.name).toBe("C");
});
