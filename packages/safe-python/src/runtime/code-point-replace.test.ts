import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const text = (value: string) => new CodePointString(Uint32Array.from([...value].map(c => c.codePointAt(0)!)));

it("allocates exactly one output buffer when inserting an empty pattern", () => {
  const source = text("a".repeat(1000)), old = text(""), replacement = text("x");
  const meter = new ExecutionBudget({ maxSteps: 4000, maxAllocatedBytes: 8004 });
  const result = source.replace(old, replacement, -1n, meter);
  expect(result.length).toBe(2001);
  expect(meter.usage.allocatedBytes).toBe(8004);
  const limited = new ExecutionBudget({ maxSteps: 4000, maxAllocatedBytes: 8003 });
  expect(() => source.replace(old, replacement, -1n, limited)).toThrow(ExecutionLimitError);
});

it("uses bounded auxiliary memory and linear work across many nonempty matches", () => {
  const source = text("ab".repeat(1000)), old = text("a"), replacement = text("XYZ");
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 16136 });
  const result = source.replace(old, replacement, -1n, meter);
  expect(result.length).toBe(4000);
  expect([...result].slice(0, 8)).toEqual([88, 89, 90, 98, 88, 89, 90, 98]);
  expect(meter.usage.allocatedBytes).toBe(16136);
});

it("returns before searching or allocating for a zero limit", () => {
  const source = text("payload"), old = text("pay"), replacement = text("x");
  const meter = new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 });
  expect(source.replace(old, replacement, 0n, meter)).toBe(source);
});
