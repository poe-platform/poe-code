import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

it("joins with exactly one charged output buffer and linear work", () => {
  const separator = new CodePointString(new Uint32Array([44])), item = new CodePointString(new Uint32Array([97]));
  const meter = new ExecutionBudget({ maxSteps: 500, maxAllocatedBytes: 199 * 4 });
  const result = separator.join(new Array(100).fill(item), meter);
  expect(result.length).toBe(199); expect([...result].slice(0, 5)).toEqual([97, 44, 97, 44, 97]);
});

it("checks allocation before constructing the joined output", () => {
  const separator = new CodePointString(new Uint32Array([44])), item = new CodePointString(new Uint32Array([97]));
  expect(() => separator.join([item, item], new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 11 }))).toThrow(ExecutionLimitError);
});

it("retains singleton immutable storage without allocating", () => {
  const item = new CodePointString(new Uint32Array([97]));
  expect(item.join([item], new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toBe(item);
});
