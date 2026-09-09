import { describe, expect, it } from "vitest";
import { ConstantValues, type ConstantValue } from "./constant-values.js";
import { constantTruth } from "./constant-truth.js";
import { constantUnary } from "./constant-unary.js";
import { constantComparison } from "./constant-comparison.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete constant truth", () => {
  it("tests singleton values without host object truthiness", () => {
    const { meter, values: v } = fixture();
    expect([v.none, v.false, v.true, v.ellipsis].map(value => constantTruth(value, meter))).toEqual([false, false, true, true]);
    expect(() => constantTruth(v.notImplemented, meter)).toThrow(expect.objectContaining({ name: "TypeError", message: "NotImplemented should not be used in a boolean context" }));
  });
  it("tests numeric zero, signed zero, huge integers, infinities and NaN", () => {
    const { meter, values: v } = fixture();
    const inputs = [v.integer(0n), v.integer(-(1n << 1000n)), v.float(-0), v.float(NaN), v.float(Infinity), v.complex(-0, 0), v.complex(0, NaN), v.complex(0, -1)];
    expect(inputs.map(value => constantTruth(value, meter))).toEqual([false, true, false, true, true, false, true, true]);
  });
  it("tests string and byte lengths, including zero-valued elements", () => {
    const { meter, values: v } = fixture();
    expect([v.string(""), v.string("\0"), v.stringPoints(Uint32Array.of(0xd800)), v.bytes(new Uint8Array()), v.bytes(Uint8Array.of(0))].map(value => constantTruth(value, meter))).toEqual([false, true, true, false, true]);
  });
  it("does not inspect or coerce tuple members", () => {
    const { meter, values: v } = fixture();
    expect(constantTruth(v.tuple([]), meter)).toBe(false);
    expect(constantTruth(v.tuple([v.notImplemented]), meter)).toBe(true);
    expect(constantTruth(v.tuple([{ get kind(): never { throw new Error("member inspected"); } }]), meter)).toBe(true);
  });
  it("charges one step and no allocation regardless of payload size", () => {
    const { meter, values: v } = fixture(), value = v.tuple(new Array(100).fill(v.none));
    const before = meter.usage;
    constantTruth(value, meter);
    expect(meter.usage.steps - before.steps).toBe(1);
    expect(meter.usage.allocatedBytes).toBe(before.allocatedBytes);
  });
  it("honors fatal budget exhaustion before testing any value", () => {
    const { values: v } = fixture(), meter = new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 });
    constantTruth(v.none, meter);
    expect(() => constantTruth(v.notImplemented, meter)).toThrow(ExecutionLimitError);
  });
  it("connects concrete values to logical expressions, branch mode and short circuiting", () => {
    const { meter, values: v } = fixture();
    const unexpected = (): never => { throw new Error("unexpected operation"); };
    const context: ExpressionContext<ConstantValue> = {
      literal: node => v.literal(node), boolean: value => v.boolean(value), truth: value => constantTruth(value, meter),
      load: name => { if (name === "NotImplemented") return v.notImplemented; return unexpected(); }, store: unexpected,
      unary: (operator, value) => constantUnary(operator, value, { values: v, warn: unexpected }, meter),
      binary: unexpected, compare: (operator, left, right) => constantComparison(operator, left, right, v, meter), attribute: unexpected, beginCall: unexpected,
      tuple: values => v.tuple(values), list: unexpected, beginSet: unexpected, beginDictionary: unexpected,
      slice: unexpected, getItem: unexpected, iterate: unexpected
    };
    const run = (source: string) => evaluateExpression(parseExpression(source), context, meter);
    expect(run("not 0")).toBe(v.true);
    expect(run("not (None,)")).toBe(v.false);
    expect(run("0 < 1 < 2")).toBe(v.true);
    expect(run("(1, 2) < (1, 3)")).toBe(v.true);
    expect(run("not (1 == 1.0)")).toBe(v.false);
    expect(run("False and NotImplemented")).toBe(v.false);
    expect(run("True or NotImplemented")).toBe(v.true);
    expect(run("False or NotImplemented")).toBe(v.notImplemented);
    expect(() => evaluateExpression(parseExpression("False or NotImplemented"), context, meter, "branch")).toThrow("NotImplemented should not be used in a boolean context");
    expect(evaluateExpression(parseExpression("b'\\x00' and (0,)"), context, meter, "branch")).toBe(true);
  });
});
