import { expect, it } from "vitest";
import { ImmutableBytes } from "./immutable-bytes.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const storage = (bytes: number[]) => ImmutableBytes.copyOf(Uint8Array.from(bytes), new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 10000 }));

it("compares only the requested edge without allocating slices", () => {
  const source = storage([0, ...Array<number>(1000).fill(97), 255]), prefix = storage([0, 97]), suffix = storage([97, 255]);
  const meter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 0 });
  expect(source.hasAffix(prefix, "start", 0n, null, meter)).toBe(true);
  expect(source.hasAffix(suffix, "end", 0n, null, meter)).toBe(true);
});

it("rejects boundary mismatches before scanning interior bytes", () => {
  const source = storage(Array<number>(1000).fill(97)), affix = storage([...Array<number>(999).fill(97), 98]);
  expect(source.hasAffix(affix, "start", 0n, null, new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 0 }))).toBe(false);
});

it("checks work limits inside matching affixes", () => {
  const source = storage(Array<number>(1000).fill(97));
  expect(() => source.hasAffix(source, "end", 0n, null, new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
});
