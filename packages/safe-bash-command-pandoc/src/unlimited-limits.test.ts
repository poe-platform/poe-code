import { expect, it } from "vitest";
import { createExecutionContext, defaultLimits } from "./execution.js";

it("disables all resource limits by default and admits explicit Infinity", () => {
  expect(Object.values(defaultLimits).every(value => value === Infinity)).toBe(true);
  const limits = Object.fromEntries(Object.keys(defaultLimits).map(key => [key, Infinity]));
  const context = createExecutionContext("convert", { limits });
  context.charge("pages", 1001);
  context.bound("depth", 129);
  expect(context.remaining("pages")).toBe(Infinity);
});
it.each([NaN, -Infinity, -1, 0.5])("rejects invalid resource limit %s", value => {
  expect(() => createExecutionContext("convert", { limits: { pages: value } })).toThrow("Invalid limit");
});
it("still enforces explicitly configured finite limits", () => {
  const context = createExecutionContext("convert", { limits: { pages: 1 } });
  context.charge("pages", 1);
  expect(() => context.charge("pages", 1)).toThrow("exceeds");
});
