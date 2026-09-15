import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";

function source(input: number[]) {
  return ImmutableBytes.copyOf(Uint8Array.from(input), new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }));
}
function budget() { return new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }); }

it("decodes empty, single-byte and both endian multi-byte magnitudes", () => {
  for (const little of [false, true]) for (const signed of [false, true]) expect(source([]).toInteger(little, signed, budget())).toBe(0n);
  expect(source([0x12, 0x34, 0x56]).toInteger(false, false, budget())).toBe(0x123456n);
  expect(source([0x12, 0x34, 0x56]).toInteger(true, false, budget())).toBe(0x563412n);
  for (let n = 0; n < 256; n++) {
    expect(source([n]).toInteger(false, false, budget())).toBe(BigInt(n));
    expect(source([n]).toInteger(false, true, budget())).toBe(BigInt(n < 128 ? n : n - 256));
  }
});

it("uses the most-significant byte for two's-complement interpretation", () => {
  expect(source([128, 0]).toInteger(false, true, budget())).toBe(-32768n);
  expect(source([128, 0]).toInteger(true, true, budget())).toBe(128n);
  expect(source([255, 0]).toInteger(false, true, budget())).toBe(-256n);
  expect(source([255, 127]).toInteger(true, true, budget())).toBe(32767n);
});

it("skips redundant sign extension without allocating magnitude text", () => {
  for (const little of [false, true]) for (const byte of [0, 255]) {
    const meter = new ExecutionBudget({ maxSteps: 3000, maxAllocatedBytes: 0 });
    expect(source(Array<number>(2000).fill(byte)).toInteger(little, true, meter)).toBe(byte === 0 ? 0n : -1n);
    expect(meter.usage.allocatedBytes).toBe(0);
  }
});

it("round-trips large positive and negative values without changing source bytes", () => {
  for (const little of [false, true]) for (const n of [1n << 1000n, -(1n << 1000n), (1n << 999n) + 123n, -((1n << 999n) + 123n)]) {
    const meter = budget(), bytes = ImmutableBytes.fromInteger(n, 128n, little, true, meter), before = [...bytes];
    expect(bytes.toInteger(little, true, meter)).toBe(n);
    expect([...bytes]).toEqual(before);
  }
});

it("checks scanning and reserves temporary storage before decoding", () => {
  const bytes = source(Array<number>(2000).fill(1));
  expect(() => bytes.toInteger(false, false, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100 }))).toThrow(ExecutionLimitError);
  expect(() => bytes.toInteger(false, false, new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 1000000 }))).toThrow(ExecutionLimitError);
  expect(() => source(Array<number>(2000).fill(0)).toInteger(false, false, new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
});
