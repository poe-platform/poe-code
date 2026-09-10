import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { allocateProducedSandboxValue } from "./values.js";

it.each([false, true])("checks non-enumerable produced data on arrays=%s", array => {
  const value = Object.defineProperty(array ? [] : {}, "hidden", { value: "x".repeat(17) });
  expect(() => allocateProducedSandboxValue(value, new Budget({ stringLength: 16 })))
    .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "stringLength" }));
});

it.each([false, true])("does not invoke produced accessors on arrays=%s", array => {
  const getter = vi.fn(() => "value");
  const value = Object.defineProperty(array ? [1] : {}, array ? "0" : "value", { get: getter, enumerable: true });
  allocateProducedSandboxValue(value, new Budget());
  expect(getter).not.toHaveBeenCalled();
});

it("handles sparse arrays and cyclic non-enumerable produced data", () => {
  const value = new Array(4);
  Object.defineProperty(value, "self", { value });
  Object.defineProperty(value, "last", { value: "four" });
  expect(allocateProducedSandboxValue(value, new Budget({ arrayLength: 4, stringLength: 4 }))).toBe(value);
});
