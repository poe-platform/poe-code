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

it("uses original context for final sigma and allocates expanded lowercase exactly", () => {
  const source = new CodePointString(Uint32Array.of(0x130, 0x3a3));
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 12 });
  expect([...source.transformCase("lower", meter)]).toEqual([0x69, 0x307, 0x3c2]);
  expect(meter.usage.allocatedBytes).toBe(12);
});

it("keeps long sigma/ignorable runs linear and checks context-scan budgets", () => {
  const run = (count: number) => {
    const input = new Uint32Array(count * 21 + 1).fill(0x301); input[0] = 65;
    for (let i = 1; i < input.length; i += 21) input[i] = 0x3a3;
    const source = new CodePointString(input), meter = new ExecutionBudget({ maxSteps: input.length * 100, maxAllocatedBytes: input.byteLength });
    const result = source.transformCase("lower", meter);
    expect(result.codePointAt(BigInt(input.length - 21))).toBe(0x3c2);
    return meter.usage.steps;
  };
  expect(run(40)).toBeLessThan(run(20) * 2.1);
  const source = new CodePointString(Uint32Array.from([65, 0x3a3, ...Array<number>(100).fill(0x301)]));
  expect(() => source.transformCase("lower", new ExecutionBudget({ maxSteps: 150, maxAllocatedBytes: 408 }))).toThrow(ExecutionLimitError);
});
