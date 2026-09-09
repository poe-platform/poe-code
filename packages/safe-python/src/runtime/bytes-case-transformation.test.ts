import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

it.each(["upper", "lower", "title", "capitalize", "swapcase"] as const)("transforms %s in one exactly sized owned buffer", mode => {
  const input = Uint8Array.from({ length: 256 }, (_, i) => i);
  const source = ImmutableBytes.copyOf(input, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 256 }));
  const meter = new ExecutionBudget({ maxSteps: 300, maxAllocatedBytes: 256 });
  const result = source.transformCase(mode, meter);
  expect(result.length).toBe(256); expect(meter.usage.allocatedBytes).toBe(256);
  expect([...result].slice(128)).toEqual([...input].slice(128));
  result.toUint8Array(new ExecutionBudget({ maxSteps: 300, maxAllocatedBytes: 256 })).fill(0);
  expect([...source]).toEqual([...input]);
});

it("treats non-ASCII bytes as title word boundaries", () => {
  const source = ImmutableBytes.copyOf(Uint8Array.of(97, 0xdf, 98, 0, 99), new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 5 }));
  expect([...source.transformCase("title", new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 5 }))]).toEqual([65, 0xdf, 66, 0, 67]);
});

it("rejects allocation before scanning and meters each transformed byte", () => {
  const source = ImmutableBytes.copyOf(new Uint8Array(100).fill(97), new ExecutionBudget({ maxSteps: 200, maxAllocatedBytes: 100 }));
  const allocation = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 99 });
  expect(() => source.transformCase("upper", allocation)).toThrow(ExecutionLimitError);
  expect(allocation.usage.allocatedBytes).toBe(0);
  expect(() => source.transformCase("lower", new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
});

it("returns empty storage without allocating output", () => {
  const source = ImmutableBytes.copyOf(new Uint8Array(), new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }));
  expect(source.transformCase("title", new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toBe(source);
});
