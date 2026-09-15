import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { numericComparison } from "./numeric-comparison.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { dispatchRichComparison } from "./comparison-dispatch.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete numeric pair comparisons", () => {
  it("compares booleans as exact integers and returns canonical booleans", () => {
    const { meter, values: v } = fixture();
    expect(numericComparison("==", v.true, v.integer(1), v, meter)).toBe(v.true);
    expect(numericComparison("==", v.false, v.float(-0), v, meter)).toBe(v.true);
    expect(numericComparison("<", v.false, v.true, v, meter)).toBe(v.true);
    expect(numericComparison("!=", v.true, v.float(1), v, meter)).toBe(v.false);
  });
  it("retains all integer bits in mixed comparisons", () => {
    const { meter, values: v } = fixture();
    const integer = v.integer((1n << 53n) + 1n), float = v.float(2 ** 53);
    expect(numericComparison("==", integer, float, v, meter)).toBe(v.false);
    expect(numericComparison(">", integer, float, v, meter)).toBe(v.true);
    expect(numericComparison("<", float, integer, v, meter)).toBe(v.true);
    expect(numericComparison("<", v.integer(1n << 10000n), v.float(Infinity), v, meter)).toBe(v.true);
  });
  it("does not shortcut NaN equality by object identity", () => {
    const { meter, values: v } = fixture(), nan = v.float(NaN);
    for (const operator of ["==", "<", ">", "<=", ">="]) expect(numericComparison(operator, nan, nan, v, meter)).toBe(v.false);
    expect(numericComparison("!=", nan, nan, v, meter)).toBe(v.true);
  });
  it("compares complex components and real operands without lossy coercion", () => {
    const { meter, values: v } = fixture(), complex = v.complex(2 ** 53, -0);
    expect(numericComparison("==", complex, v.integer(1n << 53n), v, meter)).toBe(v.true);
    expect(numericComparison("==", complex, v.integer((1n << 53n) + 1n), v, meter)).toBe(v.false);
    expect(numericComparison("==", v.integer(1n << 10000n), complex, v, meter)).toBe(v.false);
    expect(numericComparison("!=", v.complex(1, 1), v.true, v, meter)).toBe(v.true);
    expect(numericComparison("==", v.complex(Infinity, -0), v.float(Infinity), v, meter)).toBe(v.true);
    const nan = v.complex(1, NaN);
    expect(numericComparison("==", nan, nan, v, meter)).toBe(v.false);
    expect(numericComparison("!=", nan, nan, v, meter)).toBe(v.true);
  });
  it("declines complex ordering and nonnumeric operands for reflected dispatch", () => {
    const { meter, values: v } = fixture();
    for (const operator of ["<", ">", "<=", ">="]) {
      expect(numericComparison(operator, v.complex(0, 0), v.integer(0), v, meter)).toBe(v.notImplemented);
      expect(numericComparison(operator, v.integer(0), v.complex(0, 0), v, meter)).toBe(v.notImplemented);
    }
    for (const right of [v.none, v.notImplemented, v.ellipsis, v.string("1"), v.bytes(Uint8Array.of(1)), v.tuple([])]) {
      for (const operator of ["==", "!=", "<", ">", "<=", ">="]) expect(numericComparison(operator, v.integer(1), right, v, meter)).toBe(v.notImplemented);
    }
  });
  it("lets the rich-comparison dispatcher try reflected behavior after declining", () => {
    const { meter, values: v } = fixture(), left = v.integer(1), right = v.string("custom"), events: string[] = [];
    const result = dispatchRichComparison({ rightIsStrictSubtype: false, notImplemented: v.notImplemented,
      forward: () => { events.push("forward"); return numericComparison("==", left, right, v, meter); },
      reflected: () => { events.push("reflected"); return v.true; }
    }, meter);
    expect(result).toBe(v.true); expect(events).toEqual(["forward", "reflected"]);
  });
  it("does not allocate a tagged result and honors fatal exhaustion", () => {
    const { meter, values: v } = fixture(), before = meter.usage.allocatedBytes;
    numericComparison("==", v.true, v.false, v, meter);
    expect(meter.usage.allocatedBytes).toBe(before);
    expect(() => numericComparison("==", v.true, v.false, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
  it("rejects unsupported operator spellings as host integration errors", () => {
    const { meter, values: v } = fixture();
    expect(() => numericComparison("is", v.true, v.true, v, meter)).toThrow("unsupported numeric comparison operator: is");
  });
});
