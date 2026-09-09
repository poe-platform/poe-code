import { describe, expect, it } from "vitest";
import { constantBinary } from "./constant-binary.js";
import { ConstantValues, type ConstantValue } from "./constant-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";
import type { Expression } from "../ast.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("constant binary dispatch", () => {
  it.each([["+", 10n], ["-", 4n], ["*", 21n], ["//", 2n], ["%", 1n], ["**", 343n], ["&", 3n], ["|", 7n], ["^", 4n], ["<<", 56n], [">>", 0n]] as const)("routes integer %s", (operator, expected) => {
    const { meter, values: v } = fixture();
    expect(constantBinary(operator, v.integer(7n), v.integer(3n), v, meter)).toEqual(v.integer(expected));
  });
  it("routes mixed real and complex arithmetic without losing result types", () => {
    const { meter, values: v } = fixture();
    expect(constantBinary("/", v.integer(7), v.integer(2), v, meter)).toEqual(v.float(3.5));
    expect(constantBinary("+", v.integer(2), v.float(0.5), v, meter)).toEqual(v.float(2.5));
    expect(constantBinary("*", v.integer(2), v.complex(1, 3), v, meter)).toEqual(v.complex(2, 6));
    expect(constantBinary("&", v.true, v.false, v, meter)).toBe(v.false);
  });
  it("connects immutable sequence concatenation and reflected repetition", () => {
    const { meter, values: v } = fixture(), a = v.tuple([v.integer(1)]), b = v.tuple([v.integer(2)]);
    expect(constantBinary("+", a, b, v, meter)).toEqual(v.tuple([v.integer(1), v.integer(2)]));
    expect(constantBinary("*", v.integer(2), a, v, meter)).toEqual(v.tuple([v.integer(1), v.integer(1)]));
    expect(constantBinary("*", a, v.integer(1), v, meter)).toBe(a);
  });
  it("propagates matched-kernel errors without trying unrelated operations", () => {
    const { meter, values: v } = fixture();
    expect(() => constantBinary("/", v.integer(1), v.integer(0), v, meter)).toThrow("division by zero");
    expect(() => constantBinary("<<", v.integer(1), v.integer(-1), v, meter)).toThrow("negative shift count");
    expect(() => constantBinary("*", v.tuple([]), v.integer(1n << 100n), v, meter)).toThrow("cannot fit 'int' into an index-sized integer");
  });
  it("declines unavailable families and operand combinations", () => {
    const { meter, values: v } = fixture();
    expect(constantBinary("+", v.none, v.integer(1), v, meter)).toBe(v.notImplemented);
    expect(constantBinary("@", v.integer(1), v.integer(2), v, meter)).toBe(v.notImplemented);
    expect(constantBinary("**", v.float(2), v.float(0.5), v, meter)).toBe(v.notImplemented);
    expect(constantBinary("//", v.complex(1, 2), v.integer(1), v, meter)).toBe(v.notImplemented);
  });
  it("executes parsed operator precedence through the expression evaluator", () => {
    const { meter, values: v } = fixture();
    const context = {
      literal: (node: Extract<Expression, { kind: "literal" }>) => v.literal(node),
      binary: (operator: string, left: ConstantValue, right: ConstantValue) => constantBinary(operator, left, right, v, meter)
    } as ExpressionContext<ConstantValue>;
    expect(evaluateExpression(parseExpression("(7 + 3) * 2 ** 3 - 5 // 2"), context, meter)).toEqual(v.integer(78));
  });
  it("checks execution limits before dispatch", () => {
    const { values: v } = fixture();
    expect(() => constantBinary("+", v.integer(1), v.integer(2), v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
