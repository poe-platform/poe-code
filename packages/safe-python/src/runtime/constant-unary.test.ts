import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { constantUnary } from "./constant-unary.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const values = new ConstantValues(meter), warnings: string[] = [];
  const context = { values, warn: (category: string, message: string) => { warnings.push(`${category}: ${message}`); } };
  return { meter, values, context, warnings };
}

describe("concrete unary operators", () => {
  it("preserves exact numeric values for unary plus", () => {
    const { meter, values: v, context } = fixture();
    for (const value of [v.integer(1n << 1000n), v.float(-0), v.complex(NaN, -0)]) expect(constantUnary("+", value, context, meter)).toBe(value);
  });
  it("converts bool arithmetic results to int", () => {
    const { meter, values: v, context, warnings } = fixture();
    for (const [value, positive, negative, inverted] of [[v.true, 1n, -1n, -2n], [v.false, 0n, 0n, -1n]] as const) {
      expect(constantUnary("+", value, context, meter)).toEqual({ kind: "int", value: positive });
      expect(constantUnary("-", value, context, meter)).toEqual({ kind: "int", value: negative });
      expect(constantUnary("~", value, context, meter)).toEqual({ kind: "int", value: inverted });
    }
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("DeprecationWarning: Bitwise inversion '~' on bool is deprecated");
  });
  it("negates and inverts arbitrary-size signed integers exactly", () => {
    const { meter, values: v, context } = fixture();
    for (const value of [0n, 1n, -1n, 1n << 1000n, -(1n << 1000n)]) {
      expect(constantUnary("-", v.integer(value), context, meter)).toEqual({ kind: "int", value: -value });
      expect(constantUnary("~", v.integer(value), context, meter)).toEqual({ kind: "int", value: ~value });
    }
  });
  it("preserves floating signed zeros and negates both complex components", () => {
    const { meter, values: v, context } = fixture();
    expect(constantUnary("-", v.float(0), context, meter)).toEqual({ kind: "float", value: -0 });
    expect(constantUnary("-", v.float(-0), context, meter)).toEqual({ kind: "float", value: 0 });
    expect(constantUnary("-", v.float(Infinity), context, meter)).toEqual({ kind: "float", value: -Infinity });
    expect(constantUnary("-", v.complex(0, -0), context, meter)).toEqual({ kind: "complex", real: -0, imaginary: 0 });
    expect(constantUnary("-", v.complex(NaN, Infinity), context, meter)).toEqual({ kind: "complex", real: NaN, imaginary: -Infinity });
  });
  it("uses Python operand type names in errors", () => {
    const { meter, values: v, context } = fixture();
    for (const [value, name] of [[v.none, "NoneType"], [v.ellipsis, "ellipsis"], [v.notImplemented, "NotImplementedType"], [v.string(""), "str"], [v.bytes(new Uint8Array()), "bytes"], [v.tuple([]), "tuple"]] as const) {
      for (const operator of ["+", "-", "~"]) expect(() => constantUnary(operator, value, context, meter)).toThrow(expect.objectContaining({ name: "TypeError", message: `bad operand type for unary ${operator}: '${name}'` }));
    }
    for (const value of [v.float(1), v.complex(1, 0)]) expect(() => constantUnary("~", value, context, meter)).toThrow(`bad operand type for unary ~: '${value.kind}'`);
  });
  it("returns canonical booleans for not and preserves truth errors", () => {
    const { meter, values: v, context } = fixture();
    expect(constantUnary("not", v.integer(0), context, meter)).toBe(v.true);
    expect(constantUnary("not", v.float(NaN), context, meter)).toBe(v.false);
    expect(() => constantUnary("not", v.notImplemented, context, meter)).toThrow("NotImplemented should not be used in a boolean context");
  });
  it("propagates warning-as-error before allocating an arithmetic result", () => {
    const { meter, values: v } = fixture(), before = meter.usage.allocatedBytes, error = new Error("warning treated as error");
    expect(() => constantUnary("~", v.true, { values: v, warn: () => { throw error; } }, meter)).toThrow(error);
    expect(meter.usage.allocatedBytes).toBe(before);
  });
  it("checks the budget before warnings or operations", () => {
    const { values: v, context, warnings } = fixture();
    const meter = new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 });
    expect(() => constantUnary("~", v.true, context, meter)).toThrow(ExecutionLimitError);
    expect(warnings).toEqual([]);
  });
  it("rejects unknown operators as host integration errors", () => {
    const { meter, values: v, context } = fixture();
    expect(() => constantUnary("unknown", v.none, context, meter)).toThrow("unsupported constant unary operator: unknown");
  });
});
