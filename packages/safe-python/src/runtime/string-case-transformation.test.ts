import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

it("expands full case mappings into one exactly sized buffer", () => {
  const source = new CodePointString(Uint32Array.of(0xdf, 0xfb03, 0xd800, 0xdc00));
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 28 });
  const result = source.transformCase("upper", meter);
  expect([...result]).toEqual([83, 83, 70, 70, 73, 0xd800, 0xdc00]);
  expect(meter.usage.allocatedBytes).toBe(28);
  expect([...source]).toEqual([0xdf, 0xfb03, 0xd800, 0xdc00]);
});

it("rejects output over budget before allocating the result", () => {
  const source = new CodePointString(Uint32Array.of(0xfb03));
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 11 });
  expect(() => source.transformCase("casefold", meter)).toThrow(ExecutionLimitError);
});

it("meters both sizing and output passes", () => {
  const source = new CodePointString(new Uint32Array(100).fill(0xdf));
  expect(() => source.transformCase("upper", new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 800 }))).toThrow(ExecutionLimitError);
  expect(() => source.transformCase("upper", new ExecutionBudget({ maxSteps: 150, maxAllocatedBytes: 800 }))).toThrow(ExecutionLimitError);
  const meter = new ExecutionBudget({ maxSteps: 500, maxAllocatedBytes: 800 });
  expect(source.transformCase("upper", meter).length).toBe(200);
});

it("returns empty storage without an output allocation", () => {
  const source = new CodePointString(new Uint32Array());
  expect(source.transformCase("casefold", new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toBe(source);
});
