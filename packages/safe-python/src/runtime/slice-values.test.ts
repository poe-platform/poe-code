import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantTruth } from "./constant-truth.js";
import { constantComparison } from "./constant-comparison.js";
import { constantIndex } from "./constant-index.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete slice values", () => {
  it("fills omitted components with None and preserves explicit value identity", () => {
    const { values: v } = fixture(), start = v.tuple([v.none]), stop = v.string("stop");
    const slice = v.slice({ lower: start, upper: stop });
    expect(slice).toEqual({ kind: "slice", start, stop, step: v.none });
    expect(slice.start).toBe(start); expect(slice.stop).toBe(stop);
    expect(Object.isFrozen(slice)).toBe(true);
    expect(v.slice({})).toEqual({ kind: "slice", start: v.none, stop: v.none, step: v.none });
  });
  it("defers zero-step and component type validation until subscription", () => {
    const { meter, values: v } = fixture(), slice = v.slice({ lower: v.string("invalid"), step: v.false });
    expect(slice.step).toBe(v.false);
    expect(() => constantIndex(v.string("abc"), slice, v, meter)).toThrow("slice step cannot be zero");
    expect(() => constantIndex(v.none, slice, v, meter)).toThrow("'NoneType' object is not subscriptable");
  });
  it("treats every slice as true without testing its components", () => {
    const { meter, values: v } = fixture();
    expect(constantTruth(v.slice({}), meter)).toBe(true);
    expect(constantTruth(v.slice({ step: v.notImplemented }), meter)).toBe(true);
  });
  it("compares start, stop and step lexicographically with identity shortcuts", () => {
    const { meter, values: v } = fixture(), nan = v.float(NaN), first = v.slice({ lower: nan }), second = v.slice({ lower: nan });
    expect(constantComparison("==", first, second, v, meter)).toBe(v.true);
    expect(constantComparison("==", first, v.slice({ lower: v.float(NaN) }), v, meter)).toBe(v.false);
    expect(constantComparison("<", v.slice({ upper: v.integer(1) }), v.slice({ upper: v.integer(2) }), v, meter)).toBe(v.true);
    expect(constantComparison("==", first, v.tuple([nan, v.none, v.none]), v, meter)).toBe(v.false);
  });
  it("preserves component ordering errors rather than reporting slice types", () => {
    const { meter, values: v } = fixture();
    expect(() => constantComparison("<", v.slice({}), v.slice({ lower: v.integer(1) }), v, meter)).toThrow("'<' not supported between instances of 'NoneType' and 'int'");
  });
  it("applies slice keys to each immutable sequence type", () => {
    const { meter, values: v } = fixture(), reverse = v.slice({ step: v.integer(-1) });
    const text = constantIndex(v.string("a😀"), reverse, v, meter);
    if (text.kind !== "str") throw new Error("expected string");
    expect([...text.value]).toEqual([0x1f600, 97]);
    expect(constantIndex(v.tuple([v.true, v.false]), reverse, v, meter)).toEqual(v.tuple([v.false, v.true]));
    const bytes = constantIndex(v.bytes(Uint8Array.of(1, 2)), reverse, v, meter);
    if (bytes.kind !== "bytes") throw new Error("expected bytes");
    expect([...bytes.value]).toEqual([2, 1]);
  });
  it("charges a tagged record and its three references before allocation", () => {
    const { meter, values: v } = fixture(), before = meter.usage.allocatedBytes;
    v.slice({}); expect(meter.usage.allocatedBytes - before).toBe(56);
    const limited = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 215 }), values = new ConstantValues(limited);
    expect(() => values.slice({})).toThrow(ExecutionLimitError);
    expect(limited.usage.allocatedBytes).toBe(160);
  });
});
