import { describe, expect, it } from "vitest";
import { runtimeUnary } from "./runtime-unary.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIndex } from "./runtime-index.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const values = new RuntimeValues(meter), warnings: string[] = [];
  return { meter, v: values, warnings, context: { values, warn: (category: string, message: string) => { warnings.push(`${category}:${message}`); } } };
}

describe("runtime unary operations", () => {
  it("negates runtime truth without inspecting container members", () => {
    const { meter, v, context } = fixture(), list = v.list([]);
    expect(runtimeUnary("not", list, context, meter)).toBe(v.true);
    list.items.append(list); expect(runtimeUnary("not", list, context, meter)).toBe(v.false);
    expect(runtimeUnary("not", v.tuple([list]), context, meter)).toBe(v.false);
    expect(runtimeUnary("not", v.slice({ lower: list }), context, meter)).toBe(v.false);
  });
  it("negates range and iterator truth without traversal", () => {
    const { meter, v, context } = fixture();
    expect(runtimeUnary("not", v.range(createRange(0n, 0n)), context, meter)).toBe(v.true);
    expect(runtimeUnary("not", v.range(createRange(0n, 1n << 200n)), context, meter)).toBe(v.false);
    expect(runtimeUnary("not", v.iterator({ next: () => { throw new Error("advanced"); } }), context, meter)).toBe(v.false);
  });
  it("preserves numeric identity, sign and arbitrary precision", () => {
    const { meter, v, context } = fixture(), integer = v.integer(1n << 200n), float = v.float(-0), complex = v.complex(1, -2);
    expect(runtimeUnary("+", integer, context, meter)).toBe(integer);
    expect(runtimeUnary("-", integer, context, meter)).toEqual(v.integer(-(1n << 200n)));
    expect(runtimeUnary("~", integer, context, meter)).toEqual(v.integer(~(1n << 200n)));
    expect(runtimeUnary("+", float, context, meter)).toBe(float);
    expect(runtimeUnary("-", float, context, meter)).toEqual(v.float(0));
    expect(runtimeUnary("-", complex, context, meter)).toEqual(v.complex(-1, 2));
  });
  it("routes bool inversion warnings and preserves warning-as-error behavior", () => {
    const { meter, v, context, warnings } = fixture();
    expect(runtimeUnary("~", v.true, context, meter)).toEqual(v.integer(-2n));
    expect(warnings).toHaveLength(1); expect(warnings[0]).toContain("DeprecationWarning:Bitwise inversion");
    expect(() => runtimeUnary("~", v.false, { values: v, warn: () => { throw new Error("warning promoted"); } }, meter)).toThrow("warning promoted");
  });
  it("rejects nonnumeric operands without visiting their members", () => {
    const { meter, v, context } = fixture(), list = v.list([v.notImplemented]);
    for (const operator of ["+", "-", "~"]) {
      expect(() => runtimeUnary(operator, list, context, meter)).toThrow(`bad operand type for unary ${operator}: 'list'`);
      expect(() => runtimeUnary(operator, v.tuple([list]), context, meter)).toThrow(`bad operand type for unary ${operator}: 'tuple'`);
    }
    expect(() => runtimeUnary("-", v.none, context, meter)).toThrow("bad operand type for unary -: 'NoneType'");
    expect(() => runtimeUnary("not", v.notImplemented, context, meter)).toThrow("NotImplemented should not be used in a boolean context");
  });
  it("treats unknown operators as host errors and checks fatal limits first", () => {
    const { v, context, meter } = fixture();
    expect(() => runtimeUnary("invalid", v.list([]), context, meter)).toThrow("unsupported runtime unary operator: invalid");
    expect(() => runtimeUnary("-", v.list([]), context, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
  it("observes cancellation immediately after special lookup", () => {
    const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
    const v = new RuntimeValues(meter), guest = v.cell({}), method = v.cell({});
    expect(() => runtimeUnary("+", guest, { values: v, warn() {} }, meter, {
      lookupSpecial() { controller.abort(); return method; }, call(): never { throw Error("must not call after cancellation"); }
    })).toThrow("execution cancelled");
  });
  it("observes cancellation after a unary call even for NotImplemented", () => {
    const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
    const v = new RuntimeValues(meter), guest = v.cell({});
    expect(() => runtimeUnary("-", guest, { values: v, warn() {} }, meter, {
      lookupSpecial: () => guest, call() { controller.abort(); return v.notImplemented; }
    })).toThrow("execution cancelled");
  });
  it("bounds guest unary type diagnostics by UTF-8 bytes", () => {
    const { meter, v, context } = fixture();
    expect(() => runtimeUnary("~", v.cell({}), context, meter, {
      typeName: () => "é".repeat(150), call: () => v.none
    })).toThrow(`bad operand type for unary ~: '${"é".repeat(100)}'`);
  });
  it("connects parsed not, negative indices and negative slice steps", () => {
    const { meter, v, context: unary } = fixture();
    const context = {
      literal: node => v.literal(node), list: items => v.list(items), tuple: items => v.tuple(items),
      unary: (operator, value) => runtimeUnary(operator, value, unary, meter),
      truth: value => runtimeTruth(value, meter), boolean: value => v.boolean(value),
      slice: parts => v.slice(parts), getItem: (object, key) => runtimeIndex(object, key, v, meter)
    } as ExpressionContext<RuntimeValue>;
    expect(evaluateExpression(parseExpression("not []"), context, meter)).toBe(v.true);
    expect(evaluateExpression(parseExpression("not [False]"), context, meter)).toBe(v.false);
    expect(evaluateExpression(parseExpression("[1, 2, 3][-1]"), context, meter)).toEqual(v.integer(3n));
    expect(evaluateExpression(parseExpression("[1, 2, 3][::-1][0]"), context, meter)).toEqual(v.integer(3n));
  });
});
