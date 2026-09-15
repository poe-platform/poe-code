import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { realBinary } from "./real-binary.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete real binary arithmetic", () => {
  it.each([["+", 5n], ["-", 1n], ["*", 6n], ["//", 1n], ["%", 1n]] as const)("keeps integer %s exact", (op, expected) => {
    const { meter, values: v } = fixture();
    expect(realBinary(op, v.integer(3), v.integer(2), v, meter)).toEqual({ kind: "int", value: expected });
    expect(realBinary(op, v.true, v.true, v, meter).kind).toBe("int");
  });
  it("preserves arbitrary-size integer arithmetic and floor signs", () => {
    const { meter, values: v } = fixture(), big = 1n << 1000n;
    expect(realBinary("+", v.integer(big), v.true, v, meter)).toEqual({ kind: "int", value: big + 1n });
    expect(realBinary("*", v.integer(big), v.integer(big), v, meter)).toEqual({ kind: "int", value: big * big });
    expect(realBinary("//", v.integer(-7), v.integer(3), v, meter)).toEqual({ kind: "int", value: -3n });
    expect(realBinary("%", v.integer(7), v.integer(-3), v, meter)).toEqual({ kind: "int", value: -2n });
  });
  it("uses exact integer-ratio division without overflowing operand conversion", () => {
    const { meter, values: v } = fixture(), big = v.integer(1n << 2000n);
    expect(realBinary("/", big, big, v, meter)).toEqual({ kind: "float", value: 1 });
    expect(realBinary("/", v.false, v.integer(-1), v, meter)).toEqual({ kind: "float", value: -0 });
  });
  it("promotes mixed operands and uses Python float divmod rounding", () => {
    const { meter, values: v } = fixture();
    expect(realBinary("+", v.true, v.float(.5), v, meter)).toEqual({ kind: "float", value: 1.5 });
    expect(realBinary("//", v.integer(1), v.float(.1), v, meter)).toEqual({ kind: "float", value: 9 });
    expect(realBinary("%", v.float(0), v.integer(-1), v, meter)).toEqual({ kind: "float", value: -0 });
    expect(realBinary("*", v.float(-0), v.integer(2), v, meter)).toEqual({ kind: "float", value: -0 });
  });
  it("preserves zero-division errors and conversion-before-division precedence", () => {
    const { meter, values: v } = fixture();
    for (const op of ["/", "//", "%"]) {
      for (const a of [v.true, v.float(NaN)]) for (const b of [v.false, v.float(-0)]) expect(() => realBinary(op, a, b, v, meter)).toThrow(expect.objectContaining({ name: "ZeroDivisionError", message: "division by zero" }));
      expect(() => realBinary(op, v.integer(1n << 2000n), v.float(0), v, meter)).toThrow("int too large to convert to float");
    }
  });
  it("declines nonreal operands without conversions and validates operator names", () => {
    const { meter, values: v } = fixture();
    expect(realBinary("+", v.integer(1n << 2000n), v.complex(1, 0), v, meter)).toBe(v.notImplemented);
    expect(realBinary("*", v.true, v.string("abc"), v, meter)).toBe(v.notImplemented);
    expect(() => realBinary("**", v.true, v.true, v, meter)).toThrow("unsupported real binary operator: **");
  });
  it("checks execution limits before doing arithmetic", () => {
    const { values: v } = fixture();
    expect(() => realBinary("/", v.true, v.false, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
});
