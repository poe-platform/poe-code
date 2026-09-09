import { describe, expect, it } from "vitest";
import { runtimeIterate } from "./runtime-iteration.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new RuntimeValues(meter) };
}

describe("concrete runtime iteration", () => {
  it("iterates live list storage and permanently stops after observed exhaustion", () => {
    const { meter, values: v } = fixture(), list = v.list([v.true]);
    const iterator = runtimeIterate(list, v, meter);
    expect(iterator.next().value).toBe(v.true);
    list.items.append(list); expect(iterator.next().value).toBe(list);
    expect(iterator.next().done).toBe(true);
    list.items.append(v.false); expect(iterator.next().done).toBe(true);
  });
  it("retains mutable tuple member identity", () => {
    const { meter, values: v } = fixture(), list = v.list([]);
    const iterator = runtimeIterate(v.tuple([list]), v, meter);
    expect(iterator.next().value).toBe(list); expect(iterator.next().done).toBe(true);
  });
  it("wraps range integers lazily with independent cursors", () => {
    const { meter, values: v } = fixture(), range = v.range(createRange(3n, -(1n << 200n), -2n));
    const first = runtimeIterate(range, v, meter), second = runtimeIterate(range, v, meter);
    expect(first.next().value).toEqual(v.integer(3n)); expect(first.next().value).toEqual(v.integer(1n));
    expect(second.next().value).toEqual(v.integer(3n)); expect(meter.usage.allocatedBytes).toBeLessThan(2000);
  });
  it("finishes bounded and empty ranges without producing extra integers", () => {
    const { meter, values: v } = fixture(), iterator = runtimeIterate(v.range(createRange(0n, 1n)), v, meter);
    expect(iterator.next().value).toEqual(v.integer(0n));
    expect(iterator.next()).toEqual({ done: true, value: undefined });
    expect(iterator.next().done).toBe(true);
    expect(runtimeIterate(v.range(createRange(0n, 0n)), v, meter).next().done).toBe(true);
  });
  it("returns a prepared iterator unchanged without advancing it", () => {
    const { meter, values: v } = fixture(); let calls = 0;
    const source = { next: () => { calls++; return { done: false, value: v.none }; } };
    expect(runtimeIterate(v.iterator(source), v, meter)).toBe(source); expect(calls).toBe(0);
  });
  it("reuses Unicode code-point and unsigned byte iteration", () => {
    const { meter, values: v } = fixture(), text = runtimeIterate(v.string("😀x"), v, meter);
    expect(text.next().value).toEqual(v.string("😀")); expect(text.next().value).toEqual(v.string("x"));
    expect(runtimeIterate(v.bytes(Uint8Array.of(255)), v, meter).next().value).toEqual(v.integer(255n));
  });
  it("rejects non-iterables immediately with Python type names", () => {
    const { meter, values: v } = fixture();
    for (const [value, name] of [[v.none, "NoneType"], [v.integer(1n), "int"], [v.slice({}), "slice"], [v.notImplemented, "NotImplementedType"]] as const) {
      expect(() => runtimeIterate(value, v, meter)).toThrow(`'${name}' object is not iterable`);
    }
  });
  it("honors construction and range value allocation limits", () => {
    const { values: v } = fixture(), range = v.range(createRange(0n, 10n));
    expect(() => runtimeIterate(range, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 280 }), values = new RuntimeValues(meter);
    const iterator = runtimeIterate(range, values, meter);
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
  it("connects parsed starred lists and tuples to runtime iteration", () => {
    const { meter, values: v } = fixture();
    const context = {
      literal: node => v.literal(node), list: items => v.list(items), tuple: items => v.tuple(items),
      iterate: value => runtimeIterate(value, v, meter)
    } as ExpressionContext<RuntimeValue>;
    const result = evaluateExpression(parseExpression("(*[1, 2], *'x', *b'a')"), context, meter);
    expect(result).toEqual(v.tuple([v.integer(1n), v.integer(2n), v.string("x"), v.integer(97n)]));
  });
});
