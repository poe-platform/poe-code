import { describe, expect, it } from "vitest";
import { runtimeBinary } from "./runtime-binary.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { runtimeIndex } from "./runtime-index.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, v: new RuntimeValues(meter) };
}

describe("runtime binary operations", () => {
  it("concatenates lists into fresh slots retaining member identity", () => {
    const { meter, v } = fixture(), member = v.list([]), left = v.list([member]), right = v.list([v.true]);
    const result = runtimeBinary("+", left, right, v, meter);
    expect(result.kind).toBe("list"); if (result.kind !== "list") throw new Error("list expected");
    expect(result.items.snapshot()).toEqual([member, v.true]); expect(result.items.get(0n)).toBe(member);
    result.items.clear(); expect(left.items.length).toBe(1); expect(right.items.length).toBe(1);
    expect(runtimeBinary("+", left, v.list([]), v, meter)).not.toBe(left);
  });
  it("repeats lists in either order, including zero/one counts and cycles", () => {
    const { meter, v } = fixture(), list = v.list([]); list.items.append(list);
    for (const reverse of [false, true]) {
      const result = runtimeBinary("*", reverse ? v.integer(2n) : list, reverse ? list : v.integer(2n), v, meter);
      if (result.kind !== "list") throw new Error("list expected");
      expect(result.items.get(0n)).toBe(list); expect(result.items.get(1n)).toBe(list);
    }
    expect(runtimeBinary("*", list, v.true, v, meter)).not.toBe(list);
    const empty = runtimeBinary("*", list, v.false, v, meter);
    expect(empty.kind === "list" && empty.items.length).toBe(0);
  });
  it("concatenates and repeats tuples containing mutable members without copying members", () => {
    const { meter, v } = fixture(), member = v.list([]), tuple = v.tuple([member]);
    expect(runtimeBinary("+", tuple, v.tuple([]), v, meter)).toBe(tuple);
    expect(runtimeBinary("+", tuple, tuple, v, meter)).toEqual(v.tuple([member, member]));
    const repeated = runtimeBinary("*", v.integer(2n), tuple, v, meter);
    if (repeated.kind !== "tuple") throw new Error("tuple expected");
    expect(repeated.items[0]).toBe(member); expect(repeated.items[1]).toBe(member);
    expect(runtimeBinary("*", tuple, v.true, v, meter)).toBe(tuple);
  });
  it("retains scalar numeric, string and byte operations", () => {
    const { meter, v } = fixture();
    expect(runtimeBinary("+", v.integer(2n), v.float(0.5), v, meter)).toEqual(v.float(2.5));
    expect(runtimeBinary("*", v.complex(1, 2), v.integer(3n), v, meter)).toEqual(v.complex(3, 6));
    expect(runtimeBinary("**", v.integer(2n), v.integer(10n), v, meter)).toEqual(v.integer(1024n));
    expect(runtimeBinary("+", v.string("a"), v.string("😀"), v, meter)).toEqual(v.string("a😀"));
    expect(runtimeBinary("*", v.integer(2n), v.bytes(Uint8Array.of(255)), v, meter)).toEqual(v.bytes(Uint8Array.of(255, 255)));
  });
  it("declines mismatched or unavailable operands for the later guest dispatcher", () => {
    const { meter, v } = fixture(), list = v.list([]);
    expect(runtimeBinary("+", list, v.tuple([]), v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary("*", list, v.float(2), v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary("-", v.tuple([list]), v.integer(1), v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary("*", v.range(createRange(0n, 3n)), v.integer(2), v, meter)).toBe(v.notImplemented);
    expect(runtimeBinary("**", v.float(2), v.float(0.5), v, meter)).toBe(v.notImplemented);
  });
  it("propagates overflow even for empty sequences and matched numeric failures", () => {
    const { meter, v } = fixture();
    for (const sequence of [v.list([]), v.tuple([])]) expect(() => runtimeBinary("*", sequence, v.integer(1n << 100n), v, meter)).toThrow("cannot fit 'int' into an index-sized integer");
    expect(() => runtimeBinary("/", v.integer(1), v.integer(0), v, meter)).toThrow("division by zero");
  });
  it("checks execution limits and rejects unknown operators", () => {
    const { meter, v } = fixture();
    expect(() => runtimeBinary("invalid", v.list([]), v.list([]), v, meter)).toThrow("unsupported runtime binary operator: invalid");
    expect(() => runtimeBinary("+", v.list([]), v.list([]), v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
  it("connects parsed sequence arithmetic and subscription", () => {
    const { meter, v } = fixture();
    const context = {
      literal: node => v.literal(node), list: items => v.list(items), tuple: items => v.tuple(items),
      binary: (operator, left, right) => runtimeBinary(operator, left, right, v, meter),
      getItem: (object, key) => runtimeIndex(object, key, v, meter)
    } as ExpressionContext<RuntimeValue>;
    expect(evaluateExpression(parseExpression("([1, 2] + [3] * 2)[3]"), context, meter)).toEqual(v.integer(3));
    expect(evaluateExpression(parseExpression("(([1],) * 2)[1][0]"), context, meter)).toEqual(v.integer(1));
  });
});
