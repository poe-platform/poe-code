import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const text = (value: string) => new CodePointString(Uint32Array.from([...value].map(c => c.codePointAt(0)!)));

it("uses one exact-size output buffer and linear work", () => {
  const source = text("a\t".repeat(1000)), meter = new ExecutionBudget({ maxSteps: 7002, maxAllocatedBytes: 16000 });
  const result = source.expandTabs(4, meter);
  expect(result.length).toBe(4000);
  expect(meter.usage).toEqual({ steps: 7002, allocatedBytes: 16000 });
  expect([...result].slice(0, 8)).toEqual([97, 32, 32, 32, 97, 32, 32, 32]);
});

it("fails on insufficient output allocation before expansion", () => {
  const source = text("a\t");
  expect(() => source.expandTabs(4, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 15 }))).toThrow(ExecutionLimitError);
});

it("checks cancellation/step budgets inside an expanded tab", () => {
  const source = text("\t");
  expect(() => source.expandTabs(1000, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 4000 }))).toThrow(ExecutionLimitError);
});

it("returns unchanged storage with zero allocation when no tab occurs", () => {
  const source = text("payload");
  expect(source.expandTabs(8, new ExecutionBudget({ maxSteps: 8, maxAllocatedBytes: 0 }))).toBe(source);
});

it.each([NaN, Infinity, 1.5])("rejects invalid internal tab size %s", size => {
  expect(() => text("\t").expandTabs(size, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toThrow(RangeError);
});
