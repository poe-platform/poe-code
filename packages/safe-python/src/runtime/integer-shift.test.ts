import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { integerShift } from "./integer-shift.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete integer shifts", () => {
  it("shifts arbitrary-size signed integers with floor-style right shifts", () => {
    const { meter, values: v } = fixture();
    expect(integerShift("<<", v.integer(3), v.integer(1000), v, meter)).toEqual({ kind: "int", value: 3n << 1000n });
    expect(integerShift(">>", v.integer(-7), v.integer(1), v, meter)).toEqual({ kind: "int", value: -4n });
    expect(integerShift(">>", v.integer(1n << 1000n), v.integer(999), v, meter)).toEqual({ kind: "int", value: 2n });
  });
  it("converts bool operands to integers, including boolean counts", () => {
    const { meter, values: v } = fixture();
    expect(integerShift("<<", v.true, v.true, v, meter)).toEqual({ kind: "int", value: 2n });
    expect(integerShift(">>", v.true, v.false, v, meter)).toEqual({ kind: "int", value: 1n });
  });
  it("rejects negative counts before zero-operand shortcuts", () => {
    const { meter, values: v } = fixture();
    for (const op of ["<<", ">>"]) for (const left of [v.false, v.integer(-1)]) expect(() => integerShift(op, left, v.integer(-1), v, meter)).toThrow(expect.objectContaining({ name: "ValueError", message: "negative shift count" }));
  });
  it("handles enormous right shifts and zero left shifts without growth", () => {
    const { meter, values: v } = fixture(), count = v.integer(1n << 1000n);
    expect(integerShift(">>", v.integer(7), count, v, meter)).toEqual({ kind: "int", value: 0n });
    expect(integerShift(">>", v.integer(-7), count, v, meter)).toEqual({ kind: "int", value: -1n });
    expect(integerShift("<<", v.false, count, v, meter)).toEqual({ kind: "int", value: 0n });
  });
  it("charges left-shift growth before computing the result", () => {
    const { meter, values: v } = fixture(), left = v.integer(3), count = v.integer(8192), before = meter.usage.allocatedBytes;
    integerShift("<<", left, count, v, meter);
    expect(meter.usage.allocatedBytes - before).toBe(1024 + 32);
    const limited = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100 });
    expect(() => integerShift("<<", left, count, v, limited)).toThrow(ExecutionLimitError);
    expect(limited.usage.allocatedBytes).toBe(0);
  });
  it("fails unrepresentable growth through the budget before host allocation", () => {
    const { values: v } = fixture(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100 });
    expect(() => integerShift("<<", v.true, v.integer(1n << 1000n), v, meter)).toThrow(ExecutionLimitError);
    expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  });
  it("declines noninteger operands without invoking index conversion", () => {
    const { meter, values: v } = fixture();
    expect(integerShift("<<", v.true, v.float(-1), v, meter)).toBe(v.notImplemented);
    expect(integerShift(">>", v.float(1), v.true, v, meter)).toBe(v.notImplemented);
  });
  it("latches unrepresentable growth even at the largest supported budget", () => {
    const { values: v } = fixture(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: Number.MAX_SAFE_INTEGER });
    expect(() => integerShift("<<", v.true, v.integer(1n << 1000n), v, meter)).toThrow(ExecutionLimitError);
    expect(() => meter.checkpoint(0, 0)).toThrow(ExecutionLimitError);
  });
  it("checks fatal limits and rejects unknown operator names", () => {
    const { meter, values: v } = fixture();
    expect(() => integerShift("<<", v.true, v.false, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    expect(() => integerShift("&", v.true, v.true, v, meter)).toThrow("unsupported integer shift operator: &");
  });
});
