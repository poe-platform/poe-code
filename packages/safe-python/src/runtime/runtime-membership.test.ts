import { describe, expect, it } from "vitest";
import { runtimeMembership } from "./runtime-membership.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { parseExpression } from "../expression.js";
import type { ContainmentContext } from "./containment-protocol.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, v: new RuntimeValues(meter) };
}

describe("runtime membership", () => {
  it("wraps guest containment truth as canonical booleans and negates only once", () => {
    const { meter, v } = fixture(), source = v.cell({}), needle = v.cell({}), answer = v.cell({}); let calls = 0;
    const unused = (): never => { throw Error("must not iterate"); };
    const context: ContainmentContext<RuntimeValue> = {
      lookupContains: value => { expect(value).toBe(source); return arg => { expect(arg).toBe(needle); return answer; }; },
      truth: value => { expect(value).toBe(answer); calls++; return true; }, equal: unused,
      lookupIter: unused, hasNext: unused, next: unused, hasSequenceItem: unused, getItem: unused,
      isStopIteration: () => false, isIndexError: () => false, isTypeError: () => false, typeName: () => "Guest"
    };
    expect(runtimeMembership("in", needle, source, v, meter, context)).toBe(v.true);
    expect(runtimeMembership("not in", needle, source, v, meter, context)).toBe(v.false);
    expect(calls).toBe(2);
  });
  it("uses runtime equality for nested list and tuple members", () => {
    const { meter, v } = fixture(), member = v.list([v.integer(1)]), needle = v.list([v.float(1)]);
    expect(runtimeMembership("in", needle, v.list([member]), v, meter)).toBe(v.true);
    expect(runtimeMembership("not in", needle, v.tuple([member]), v, meter)).toBe(v.false);
  });
  it("preserves member identity shortcuts for NaN and cyclic objects", () => {
    const { meter, v } = fixture(), nan = v.float(NaN), cycle = v.list([]); cycle.items.append(cycle);
    expect(runtimeMembership("in", nan, v.list([nan]), v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.float(NaN), v.list([nan]), v, meter)).toBe(v.false);
    expect(runtimeMembership("in", cycle, cycle, v, meter)).toBe(v.true);
    const other = v.list([]); other.items.append(other);
    expect(() => runtimeMembership("in", other, cycle, v, meter)).toThrow(expect.objectContaining({ name: "RecursionError" }));
  });
  it("searches huge ranges arithmetically for exact integer/bool needles", () => {
    const { meter, v } = fixture(), end = 1n << 200n, range = v.range(createRange(0n, end, 2n));
    const before = meter.usage;
    expect(runtimeMembership("in", v.integer(end - 2n), range, v, meter)).toBe(v.true);
    expect(runtimeMembership("not in", v.integer(end - 1n), range, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.false, range, v, meter)).toBe(v.true);
    expect(meter.usage.steps - before.steps).toBeLessThan(30);
  });
  it("falls back to numeric equality for noninteger range needles", () => {
    const { meter, v } = fixture(), range = v.range(createRange(0n, 5n));
    expect(runtimeMembership("in", v.float(3), range, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.complex(3, 0), range, v, meter)).toBe(v.true);
    expect(runtimeMembership("in", v.float(3.5), range, v, meter)).toBe(v.false);
  });
  it("consumes iterator inputs only through the first match", () => {
    const { meter, v } = fixture(), iterator = runtimeIterate(v.list([v.integer(1), v.integer(2), v.integer(3)]), v, meter);
    expect(runtimeMembership("in", v.integer(2), v.iterator(iterator), v, meter)).toBe(v.true);
    expect(iterator.next().value).toEqual(v.integer(3)); expect(iterator.next().done).toBe(true);
  });
  it("propagates iterator failure without closing it", () => {
    const { meter, v } = fixture(); let closed = false;
    const iterator = v.iterator({ next: () => { throw new Error("next failed"); }, return: () => { closed = true; return { done: true, value: undefined }; } });
    expect(() => runtimeMembership("in", v.none, iterator, v, meter)).toThrow("next failed"); expect(closed).toBe(false);
  });
  it("rejects mutable needles for string/byte containment with proper diagnostics", () => {
    const { meter, v } = fixture();
    expect(() => runtimeMembership("in", v.list([]), v.string(""), v, meter)).toThrow("'in <string>' requires string as left operand, not list");
    expect(() => runtimeMembership("in", v.list([]), v.bytes(new Uint8Array()), v, meter)).toThrow("a bytes-like object is required, not 'list'");
  });
  it("bounds infinite iteration instead of treating it as an empty container", () => {
    const { v } = fixture(), meter = new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 });
    const iterator = v.iterator({ next: () => ({ done: false, value: v.none }) });
    expect(() => runtimeMembership("not in", v.true, iterator, v, meter)).toThrow(ExecutionLimitError);
  });
  it("connects parsed nested mutable membership expressions", () => {
    const { meter, v } = fixture();
    const context = {
      literal: node => v.literal(node), list: items => v.list(items), tuple: items => v.tuple(items),
      compare: (operator, left, right) => runtimeMembership(operator, left, right, v, meter)
    } as ExpressionContext<RuntimeValue>;
    expect(evaluateExpression(parseExpression("[1] in [[1], [2]]"), context, meter)).toBe(v.true);
    expect(evaluateExpression(parseExpression("[3] not in ([1], [2])"), context, meter)).toBe(v.true);
  });
});
