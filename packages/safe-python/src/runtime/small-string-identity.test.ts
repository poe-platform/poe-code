import { expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, values: new ConstantValues(meter) };
}
it("canonicalizes empty strings across all construction paths within one runtime", () => {
  const { values } = fixture(), empty = values.string("");
  expect(values.stringPoints(new Uint32Array(0))).toBe(empty);
  expect(values.stringPoints(empty.value, "fresh")).toBe(empty);
  expect(values.literal(parseExpression("''") as never)).toBe(empty);
  expect(fixture().values.string("")).not.toBe(empty);
});
it("caches all Latin-1 code points for canonical construction and literals", () => {
  const { values } = fixture();
  for (let point = 0; point < 256; point++) {
    const value = values.string(String.fromCodePoint(point));
    expect(values.stringPoints(Uint32Array.of(point), "canonical")).toBe(value);
    expect(values.stringPoints(value.value, "canonical")).toBe(value);
  }
  expect(values.literal(parseExpression("'é'") as never)).toBe(values.string("é"));
});
it("retains fresh nonempty identity and does not intern larger code points or strings", () => {
  const { values } = fixture(), cached = values.string("a");
  const fresh = values.stringPoints(cached.value, "fresh");
  expect(fresh).not.toBe(cached); expect(fresh.value).toBe(cached.value);
  expect(values.stringPoints(cached.value)).not.toBe(cached);
  for (const text of ["Ā", "😀", "\ud800", "ab"]) {
    const value = values.string(text);
    expect(values.stringPoints(value.value, "canonical")).not.toBe(value);
  }
});
it("reuses cached records without allocation and never retains mutable input", () => {
  const { meter, values } = fixture(), input = Uint32Array.of(233);
  const value = values.stringPoints(input, "canonical"); input[0] = 65;
  expect([...value.value]).toEqual([233]);
  const before = meter.usage.allocatedBytes;
  expect(values.stringPoints(value.value, "canonical")).toBe(value);
  expect(meter.usage.allocatedBytes).toBe(before);
  expect(values.stringPoints(input, "canonical")).toBe(values.string("A"));
});
