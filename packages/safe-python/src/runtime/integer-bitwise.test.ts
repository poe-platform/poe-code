import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { integerBitwise } from "./integer-bitwise.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { dispatchBinaryOperation } from "./binary-dispatch.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete integer bitwise operations", () => {
  it("returns canonical booleans only when both operands are bool", () => {
    const { meter, values: v } = fixture();
    for (const a of [false, true]) for (const b of [false, true]) {
      expect(integerBitwise("&", v.boolean(a), v.boolean(b), v, meter)).toBe(v.boolean(a && b));
      expect(integerBitwise("|", v.boolean(a), v.boolean(b), v, meter)).toBe(v.boolean(a || b));
      expect(integerBitwise("^", v.boolean(a), v.boolean(b), v, meter)).toBe(v.boolean(a !== b));
    }
  });
  it("returns integers for mixed bool/int pairs in either order", () => {
    const { meter, values: v } = fixture();
    for (const [op, result] of [["&", 0n], ["|", 3n], ["^", 3n]] as const) {
      expect(integerBitwise(op, v.true, v.integer(2), v, meter)).toEqual({ kind: "int", value: result });
      expect(integerBitwise(op, v.integer(2), v.true, v, meter)).toEqual({ kind: "int", value: result });
    }
  });
  it("preserves arbitrary-size bits and infinite signed two's-complement semantics", () => {
    const { meter, values: v } = fixture(), bit = 1n << 4000n;
    expect(integerBitwise("&", v.integer(-1), v.integer(bit), v, meter)).toEqual({ kind: "int", value: bit });
    expect(integerBitwise("|", v.integer(bit), v.integer(1), v, meter)).toEqual({ kind: "int", value: bit + 1n });
    expect(integerBitwise("^", v.integer(-1), v.integer(bit), v, meter)).toEqual({ kind: "int", value: -bit - 1n });
    expect(integerBitwise("&", v.integer(-5), v.integer(3), v, meter)).toEqual({ kind: "int", value: 3n });
  });
  it("declines other values without numeric or truth conversion", () => {
    const { meter, values: v } = fixture();
    for (const other of [v.float(1), v.complex(1, 0), v.none, v.notImplemented, v.tuple([]), v.slice({})]) {
      expect(integerBitwise("&", v.true, other, v, meter)).toBe(v.notImplemented);
      expect(integerBitwise("|", other, v.true, v, meter)).toBe(v.notImplemented);
    }
  });
  it("allows reflected dispatch after builtin integer behavior declines", () => {
    const { meter, values: v } = fixture(), other = v.string("custom"), events: string[] = [];
    const result = dispatchBinaryOperation({ relation: "other", notImplemented: v.notImplemented,
      forward: () => { events.push("forward"); return integerBitwise("^", v.true, other, v, meter); },
      reflected: () => { events.push("reflected"); return v.true; },
      reflectedIsOverridden: () => { throw new Error("not a subtype"); }
    }, meter);
    expect(result).toBe(v.true); expect(events).toEqual(["forward", "reflected"]);
  });
  it("does not allocate another tagged value for bool-only operations", () => {
    const { meter, values: v } = fixture(), before = meter.usage.allocatedBytes;
    integerBitwise("|", v.true, v.false, v, meter);
    expect(meter.usage.allocatedBytes).toBe(before);
  });
  it("checks fatal limits and rejects unsupported operator spellings", () => {
    const { meter, values: v } = fixture();
    expect(() => integerBitwise("&", v.true, v.false, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    expect(() => integerBitwise("<<", v.true, v.true, v, meter)).toThrow("unsupported integer bitwise operator: <<");
  });
});
