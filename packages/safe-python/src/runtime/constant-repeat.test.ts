import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantRepeat } from "./constant-repeat.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete sequence repetition", () => {
  it("repeats code points without merging surrogate boundaries", () => {
    const { meter, values: v } = fixture(), source = v.stringPoints(Uint32Array.of(0xdc00, 0xd800));
    const result = constantRepeat(source, v.integer(2), v, meter);
    if (result.kind !== "str") throw new Error("expected string");
    expect([...result.value]).toEqual([0xdc00, 0xd800, 0xdc00, 0xd800]);
  });
  it("supports integer multipliers on either side and boolean counts", () => {
    const { meter, values: v } = fixture(), bytes = v.bytes(Uint8Array.of(0, 255));
    const result = constantRepeat(v.integer(3), bytes, v, meter);
    if (result.kind !== "bytes") throw new Error("expected bytes");
    expect([...result.value]).toEqual([0, 255, 0, 255, 0, 255]);
    expect(constantRepeat(bytes, v.true, v, meter)).toBe(bytes);
  });
  it("repeats tuple references without cloning members", () => {
    const { meter, values: v } = fixture(), member = v.slice({}), source = v.tuple([member]);
    const result = constantRepeat(source, v.integer(3), v, meter);
    if (result.kind !== "tuple") throw new Error("expected tuple");
    expect(result.items).toEqual([member, member, member]);
    expect(result.items.every(item => item === member)).toBe(true);
  });
  it("returns empty sequences for zero/negative counts and preserves count-one identity", () => {
    const { meter, values: v } = fixture();
    for (const source of [v.string("a"), v.bytes(Uint8Array.of(1)), v.tuple([v.none])]) {
      expect(constantRepeat(source, v.integer(1), v, meter)).toBe(source);
      for (const count of [v.false, v.integer(-100)]) {
        const result = constantRepeat(source, count, v, meter);
        expect(result.kind).toBe(source.kind);
        expect(result.kind === "tuple" ? result.items.length : result.kind === "str" || result.kind === "bytes" ? result.value.length : -1).toBe(0);
      }
    }
  });
  it("checks signed index-size overflow even for empty sequences", () => {
    const { meter, values: v } = fixture();
    for (const source of [v.string(""), v.bytes(new Uint8Array()), v.tuple([])]) {
      for (const count of [1n << 63n, -(1n << 63n) - 1n]) expect(() => constantRepeat(source, v.integer(count), v, meter)).toThrow(expect.objectContaining({ name: "OverflowError", message: "cannot fit 'int' into an index-sized integer" }));
      expect(constantRepeat(source, v.integer((1n << 63n) - 1n), v, meter)).toBe(source);
    }
  });
  it("preserves sequence-specific overflow errors before allocating", () => {
    const { meter, values: v } = fixture(), count = v.integer((1n << 63n) - 1n);
    expect(() => constantRepeat(v.string("ab"), count, v, meter)).toThrow("repeated string is too long");
    expect(() => constantRepeat(v.bytes(Uint8Array.of(1, 2)), count, v, meter)).toThrow("repeated bytes are too long");
    expect(() => constantRepeat(v.tuple([v.none, v.true]), count, v, meter)).toThrow(expect.objectContaining({ name: "MemoryError", message: "" }));
  });
  it("charges byte payload once and refuses oversized growth before host allocation", () => {
    const { meter, values: v } = fixture(), source = v.bytes(Uint8Array.of(1, 2)), count = v.integer(3), before = meter.usage.allocatedBytes;
    constantRepeat(source, count, v, meter); expect(meter.usage.allocatedBytes - before).toBe(38);
    const limited = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 10 });
    expect(() => constantRepeat(source, v.integer(1000000), v, limited)).toThrow(ExecutionLimitError);
    expect(limited.usage.allocatedBytes).toBe(0);
  });
  it("latches allocation exhaustion when the output cannot fit a safe host length", () => {
    const { values: v } = fixture(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100 });
    expect(() => constantRepeat(v.string("x"), v.integer(1n << 60n), v, meter)).toThrow(ExecutionLimitError);
    expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  });
  it("declines noninteger or nonsequence pairs and checks fatal entry limits", () => {
    const { meter, values: v } = fixture();
    expect(constantRepeat(v.string("x"), v.float(2), v, meter)).toBe(v.notImplemented);
    expect(constantRepeat(v.true, v.true, v, meter)).toBe(v.notImplemented);
    expect(() => constantRepeat(v.true, v.true, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
