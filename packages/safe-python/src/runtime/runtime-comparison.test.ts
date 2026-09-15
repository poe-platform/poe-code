import { describe, expect, it } from "vitest";
import { runtimeComparison } from "./runtime-comparison.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  return { meter, v, compare: (op: string, a: RuntimeValue, b: RuntimeValue, depth = 1000) => runtimeComparison(op, a, b, v, meter, depth) };
}

describe("runtime rich comparison", () => {
  it("compares lists lexicographically with an equality length shortcut", () => {
    const { v, compare } = fixture(), a = v.list([v.integer(1), v.integer(2)]), b = v.list([v.integer(1), v.integer(3)]);
    expect(compare("<", a, b)).toBe(v.true); expect(compare("==", a, b)).toBe(v.false);
    expect(compare(">=", b, a)).toBe(v.true);
    expect(compare("!=", a, v.list([]))).toBe(v.true);
  });
  it("handles mixed nested lists, tuples and slices without copying members", () => {
    const { v, compare } = fixture(), a = v.tuple([v.list([v.integer(1)])]), b = v.tuple([v.list([v.integer(2)])]);
    expect(compare("<", a, b)).toBe(v.true);
    expect(compare("<", v.slice({ lower: a }), v.slice({ lower: b }))).toBe(v.true);
    expect(compare("==", v.list([]), v.tuple([]))).toBe(v.false);
    expect(() => compare("<", v.list([]), v.tuple([]))).toThrow("'<' not supported between instances of 'list' and 'tuple'");
  });
  it("skips equality for identical members but not direct NaN comparison", () => {
    const { v, compare } = fixture(), nan = v.float(NaN);
    expect(compare("==", nan, nan)).toBe(v.false);
    expect(compare("==", v.list([nan]), v.list([nan]))).toBe(v.true);
    expect(compare("==", v.list([v.float(NaN)]), v.list([v.float(NaN)]))).toBe(v.false);
  });
  it("preserves self identity but raises a controlled error for distinct cycles", () => {
    const { v, compare } = fixture(), a = v.list([]), b = v.list([]); a.items.append(a); b.items.append(b);
    expect(compare("==", a, a)).toBe(v.true); expect(compare("is", a, b)).toBe(v.false);
    expect(() => compare("==", a, b, 8)).toThrow(expect.objectContaining({ name: "RecursionError" }));
    expect(() => compare("<", a, b, 8)).toThrow(expect.objectContaining({ name: "RecursionError" }));
    expect(compare("==", v.integer(1), v.integer(1), 8)).toBe(v.true);
  });
  it("compares range sequences rather than raw stop attributes", () => {
    const { v, compare } = fixture();
    expect(compare("==", v.range(createRange(0n, 4n, 2n)), v.range(createRange(0n, 3n, 2n)))).toBe(v.true);
    expect(compare("==", v.range(createRange(3n, 0n)), v.range(createRange(0n, 0n)))).toBe(v.true);
    expect(compare("!=", v.range(createRange(0n, 4n)), v.range(createRange(0n, 3n)))).toBe(v.true);
    expect(() => compare("<", v.range(createRange(0n, 1n)), v.range(createRange(0n, 2n)))).toThrow("'<' not supported between instances of 'range' and 'range'");
  });
  it("supports explicit deep comparison limits without host recursion", () => {
    const { v, compare } = fixture(); let a: RuntimeValue = v.integer(1), b: RuntimeValue = v.integer(2);
    for (let i = 0; i < 1500; i++) { a = i % 2 ? v.list([a]) : v.tuple([a]); b = i % 2 ? v.list([b]) : v.tuple([b]); }
    expect(() => compare("==", a, b, 100)).toThrow(expect.objectContaining({ name: "RecursionError" }));
    expect(compare("==", a, b, 2000)).toBe(v.false);
  });
  it("validates the comparison-depth policy", () => {
    const { v, compare } = fixture();
    for (const depth of [0, -1, 0.5, Infinity]) expect(() => compare("==", v.none, v.none, depth)).toThrow("maximum comparison depth must be a positive safe integer");
  });
  it("charges comparison frames before work while identity needs no frame", () => {
    const { v } = fixture(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 });
    expect(runtimeComparison("is", v.none, v.none, v, meter)).toBe(v.true);
    expect(() => runtimeComparison("==", v.none, v.none, v, meter)).toThrow(ExecutionLimitError);
    expect(() => runtimeComparison("is", v.none, v.none, v, meter)).toThrow(ExecutionLimitError);
  });
});
