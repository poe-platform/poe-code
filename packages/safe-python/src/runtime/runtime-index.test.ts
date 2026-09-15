import { describe, expect, it } from "vitest";
import { runtimeIndex } from "./runtime-index.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";
import type { IntegerIndexContext } from "./index-protocol.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, v: new RuntimeValues(meter) };
}

describe("runtime subscription", () => {
  it("preserves guest type names on overflow while ranges retain arbitrary precision", () => {
    const { meter, v } = fixture(), guest = v.cell({}), end = 1n << 100n;
    const context: IntegerIndexContext<RuntimeValue> = {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "GuestIndex", warn() {},
      lookupIndex: () => () => v.integer(end)
    };
    for (const object of [v.list([]), v.tuple([]), v.string(""), v.bytes(Uint8Array.of())]) {
      expect(() => runtimeIndex(object, guest, v, meter, context)).toThrow("cannot fit 'GuestIndex' into an index-sized integer");
    }
    expect(runtimeIndex(v.range(createRange(0n, end + 1n)), guest, v, meter, context)).toEqual(v.integer(end));
  });
  it("uses storage after conversion and checks cancellation before reading it", () => {
    const { meter, v } = fixture(), guest = v.cell({}), list = v.list([v.false, v.true]);
    let cancelled = false;
    const context: IntegerIndexContext<RuntimeValue> = {
      integer: value => value.kind === "int" ? value.value : undefined,
      isExactInteger: value => value.kind === "int", typeName: () => "GuestIndex", warn() {},
      lookupIndex: () => () => { list.items.pop(0n); return v.integer(0); }
    };
    expect(runtimeIndex(list, guest, v, meter, context)).toBe(v.true);
    context.lookupIndex = () => () => { cancelled = true; return v.integer(0); };
    expect(() => runtimeIndex(list, guest, v, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } }, context)).toThrow(ExecutionLimitError);
  });
  it("retains sequence diagnostics for absent slots and propagates slot failures", () => {
    const { meter, v } = fixture(), guest = v.cell({}), list = v.list([]);
    const context: IntegerIndexContext<RuntimeValue> = {
      integer: () => undefined, isExactInteger: () => false,
      typeName: () => "GuestIndex", warn() {}, lookupIndex: () => undefined
    };
    expect(() => runtimeIndex(list, guest, v, meter, context)).toThrow("list indices must be integers or slices, not GuestIndex");
    const failure = new Error("index failed");
    context.lookupIndex = () => () => { throw failure; };
    expect(() => runtimeIndex(list, guest, v, meter, context)).toThrow(failure);
  });
  it("indexes live lists and tuples preserving mutable member identity", () => {
    const { meter, v } = fixture(), member = v.list([]), list = v.list([v.none, member]);
    expect(runtimeIndex(list, v.integer(-1n), v, meter)).toBe(member);
    expect(runtimeIndex(v.tuple([v.none, member]), v.true, v, meter)).toBe(member);
    list.items.set(1n, v.false); expect(runtimeIndex(list, v.true, v, meter)).toBe(v.false);
  });
  it("copies sliced list slots without copying members, even for full slices", () => {
    const { meter, v } = fixture(), member = v.list([]), list = v.list([member]);
    const result = runtimeIndex(list, v.slice({}), v, meter);
    expect(result.kind).toBe("list"); if (result.kind !== "list") throw new Error("list expected");
    expect(result).not.toBe(list); expect(result.items.get(0n)).toBe(member);
    result.items.clear(); expect(list.items.length).toBe(1);
  });
  it("slices mutable-member tuples and preserves full tuple identity", () => {
    const { meter, v } = fixture(), member = v.list([]), tuple = v.tuple([v.none, member]);
    expect(runtimeIndex(tuple, v.slice({}), v, meter)).toBe(tuple);
    expect(runtimeIndex(tuple, v.slice({ step: v.integer(-1n) }), v, meter)).toEqual(v.tuple([member, v.none]));
  });
  it("indexes and slices arbitrary-precision ranges without expansion", () => {
    const { meter, v } = fixture(), end = 1n << 200n, range = v.range(createRange(0n, end));
    expect(runtimeIndex(range, v.integer(end - 1n), v, meter)).toEqual(v.integer(end - 1n));
    expect(runtimeIndex(range, v.integer(-1n), v, meter)).toEqual(v.integer(end - 1n));
    expect(runtimeIndex(range, v.slice({ step: v.integer(-2n) }), v, meter)).toEqual(v.range(createRange(end - 1n, -1n, -2n)));
    expect(meter.usage.allocatedBytes).toBeLessThan(2000);
  });
  it("preserves Unicode and byte subscription", () => {
    const { meter, v } = fixture();
    expect(runtimeIndex(v.string("a😀"), v.integer(-1n), v, meter)).toEqual(v.string("😀"));
    expect(runtimeIndex(v.bytes(Uint8Array.of(0, 255)), v.true, v, meter)).toEqual(v.integer(255n));
    expect(runtimeIndex(v.string("a😀"), v.slice({ step: v.integer(-1n) }), v, meter)).toEqual(v.string("😀a"));
  });
  it("validates slice step before other bounds and rejects arbitrary components", () => {
    const { meter, v } = fixture(), list = v.list([]);
    expect(() => runtimeIndex(list, v.slice({ lower: list, step: v.integer(0n) }), v, meter)).toThrow("slice step cannot be zero");
    expect(() => runtimeIndex(list, v.slice({ lower: list }), v, meter)).toThrow("slice indices must be integers or None or have an __index__ method");
  });
  it("retains sequence-specific invalid-key, overflow and bounds diagnostics", () => {
    const { meter, v } = fixture();
    expect(() => runtimeIndex(v.list([]), v.float(1), v, meter)).toThrow("list indices must be integers or slices, not float");
    expect(() => runtimeIndex(v.range(createRange(0n, 2n)), v.list([]), v, meter)).toThrow("range indices must be integers or slices, not list");
    expect(() => runtimeIndex(v.tuple([]), v.integer(1n << 100n), v, meter)).toThrow("cannot fit 'int' into an index-sized integer");
    expect(() => runtimeIndex(v.range(createRange(0n, 2n)), v.integer(1n << 100n), v, meter)).toThrow("range object index out of range");
    expect(() => runtimeIndex(v.none, v.slice({ step: v.integer(0n) }), v, meter)).toThrow("'NoneType' object is not subscriptable");
  });
  it("checks fatal limits before access", () => {
    const { v } = fixture();
    expect(() => runtimeIndex(v.list([]), v.integer(0n), v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
  });
  it("connects parsed nested list subscription to expression execution", () => {
    const { meter, v } = fixture();
    const context = {
      literal: node => v.literal(node), list: items => v.list(items), tuple: items => v.tuple(items),
      slice: parts => v.slice(parts), getItem: (object, key) => runtimeIndex(object, key, v, meter)
    } as ExpressionContext<RuntimeValue>;
    expect(evaluateExpression(parseExpression("[[1, 2], [3, 4]][1][0]"), context, meter)).toEqual(v.integer(3n));
    expect(evaluateExpression(parseExpression("[0, 1, 2, 3][1:3][1]"), context, meter)).toEqual(v.integer(2n));
  });
});
