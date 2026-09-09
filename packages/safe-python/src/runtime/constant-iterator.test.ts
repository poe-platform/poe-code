import { describe, expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { ConstantIterator } from "./constant-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete immutable sequence iterators", () => {
  it("iterates strings by code point without combining adjacent surrogates", () => {
    const { meter, values: v } = fixture(), source = v.stringPoints(Uint32Array.of(65, 0x10000, 0xd800, 0xdc00));
    const iterator = new ConstantIterator(source, v, meter);
    expect([...iterator].map(value => value.kind === "str" ? [...value.value] : null)).toEqual([[65], [0x10000], [0xd800], [0xdc00]]);
  });
  it("returns unsigned integer byte values", () => {
    const { meter, values: v } = fixture();
    expect([...new ConstantIterator(v.bytes(Uint8Array.of(0, 127, 255)), v, meter)]).toEqual([
      { kind: "int", value: 0n }, { kind: "int", value: 127n }, { kind: "int", value: 255n }
    ]);
  });
  it("retains tuple member identity without allocating tagged values", () => {
    const { meter, values: v } = fixture(), member = v.tuple([v.none]), iterator = new ConstantIterator(v.tuple([member, v.notImplemented]), v, meter);
    const before = meter.usage.allocatedBytes;
    expect(iterator.next()).toEqual({ done: false, value: member });
    expect(iterator.next().value).toBe(v.notImplemented);
    expect(meter.usage.allocatedBytes).toBe(before);
  });
  it("exposes itself as the host iterator and tracks remaining length", () => {
    const { meter, values: v } = fixture(), iterator = new ConstantIterator(v.string("a😀"), v, meter);
    expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect(iterator.lengthHint()).toBe(2);
    iterator.next(); expect(iterator.lengthHint()).toBe(1);
    iterator.next(); expect(iterator.lengthHint()).toBe(0);
    expect(iterator.next()).toEqual({ done: true, value: undefined });
    expect(iterator.next()).toEqual({ done: true, value: undefined });
    expect(iterator.lengthHint()).toBe(0);
  });
  it("keeps independent iterator positions over shared immutable storage", () => {
    const { meter, values: v } = fixture(), source = v.tuple([v.true, v.false]);
    const first = new ConstantIterator(source, v, meter), second = new ConstantIterator(source, v, meter);
    first.next(); first.next();
    expect(second.next().value).toBe(v.true);
    expect(first.next().done).toBe(true);
  });
  it("rejects invalid receivers during construction, before first next", () => {
    const { meter, values: v } = fixture();
    expect(() => new ConstantIterator(v.none, v, meter)).toThrow("'NoneType' object is not iterable");
    expect(() => new ConstantIterator(v.notImplemented, v, meter)).toThrow("'NotImplementedType' object is not iterable");
  });
  it("checks the budget for construction, next, and length hints", () => {
    const { values: v } = fixture(), empty = v.tuple([]);
    expect(() => new ConstantIterator(empty, v, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 0 }))).toThrow(ExecutionLimitError);
    const meter = new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 1000 }), iterator = new ConstantIterator(empty, v, meter);
    expect(iterator.next().done).toBe(true);
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
    expect(() => iterator.lengthHint()).toThrow(ExecutionLimitError);
  });
  it("propagates result allocation limits instead of returning partial strings", () => {
    const { values: v } = fixture(), source = v.string("a");
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 160 }), values = new ConstantValues(meter);
    const iterator = new ConstantIterator(source, values, meter);
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
});
