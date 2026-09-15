import { expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

it.each(["left", "right", "center", "sign"] as const)("allocates one final buffer with linear work for %s padding", alignment => {
  const source = new CodePointString(Uint32Array.of(45, 52, 50));
  const meter = new ExecutionBudget({ maxSteps: 1002, maxAllocatedBytes: 4000 });
  const result = source.pad(1000n, alignment, 0x1f600, meter);
  expect(result.length).toBe(1000);
  expect(meter.usage).toEqual({ steps: 1002, allocatedBytes: 4000 });
  expect([...result].filter(point => point !== 0x1f600)).toEqual([45, 52, 50]);
  if (alignment === "sign") expect(result.codePointAt(0n)).toBe(45);
});

it("rejects output allocation before creating a buffer and checks long fill loops", () => {
  const source = new CodePointString(Uint32Array.of(120));
  expect(() => source.pad(1000n, "right", 32, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 3999 }))).toThrow(ExecutionLimitError);
  expect(() => source.pad(1000n, "right", 32, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 4000 }))).toThrow(ExecutionLimitError);
});

it("returns unchanged storage without allocation", () => {
  const source = new CodePointString(Uint32Array.of(120));
  expect(source.pad(0n, "right", 32, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toBe(source);
});

it.each([-1, 0x110000, 1.5, NaN])("rejects invalid fill code point %s even at an unchanged width", fill => {
  const source = new CodePointString(Uint32Array.of(120));
  expect(() => source.pad(0n, "right", fill, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toThrow(RangeError);
});
