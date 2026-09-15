import { describe, expect, it, vi } from "vitest";
import { readClassAttribute, lookupMroAttribute } from "./class-attributes.js";
import { ExecutionBudget } from "./execution-budget.js";
import type { ClassAttribute } from "./instance-attributes.js";

const cls = {}, metaclass = {};

describe("class attribute lookup", () => {
  it.each(Array.from({ length: 8 }, (_, mask) => mask))("handles metaclass descriptor mask %i", mask => {
    const get = vi.fn(() => "meta bound");
    const meta: ClassAttribute<object, string, object> = {
      value: "meta raw", slots: { get: mask & 1 ? get : undefined, set: mask & 2 ? () => {} : undefined, delete: mask & 4 ? () => {} : undefined }
    };
    const lookup = vi.fn(() => ({ value: "class raw" }));
    const dataGetter = Boolean((mask & 1) && (mask & 6));
    expect(readClassAttribute(cls, metaclass, meta, lookup)).toEqual({ value: dataGetter ? "meta bound" : "class raw" });
    expect(lookup).toHaveBeenCalledTimes(dataGetter ? 0 : 1);
    expect(readClassAttribute(cls, metaclass, meta, () => undefined)).toEqual({ value: mask & 1 ? "meta bound" : "meta raw" });
    if (mask & 1) expect(get).toHaveBeenCalledWith(cls, metaclass);
  });

  it("binds inherited class descriptors to None and the requested class", () => {
    const get = vi.fn(() => "class bound");
    expect(readClassAttribute(cls, metaclass, { value: "meta", slots: { get: () => "meta bound" } }, () => ({ value: "class", slots: { get } }))).toEqual({ value: "class bound" });
    expect(get).toHaveBeenCalledWith(null, cls);
  });

  it("distinguishes absent and present undefined values", () => {
    expect(readClassAttribute(cls, metaclass, undefined, () => undefined)).toBeUndefined();
    expect(readClassAttribute(cls, metaclass, { value: "meta" }, () => ({ value: undefined }))).toEqual({ value: undefined });
    expect(readClassAttribute(cls, metaclass, { value: undefined }, () => undefined)).toEqual({ value: undefined });
  });

  it("does not swallow descriptor errors or continue lookup", () => {
    const fault = new TypeError("non-callable slot"), lookup = vi.fn();
    const get = () => { throw fault; };
    expect(() => readClassAttribute(cls, metaclass, { value: "meta", slots: { get, set: () => {} } }, lookup)).toThrow(fault);
    expect(lookup).not.toHaveBeenCalled();
    expect(() => readClassAttribute(cls, metaclass, { value: "meta" }, () => ({ value: "class", slots: { get } }))).toThrow(fault);
  });

  it("checks budgets before namespace and descriptor calls", () => {
    const lookup = vi.fn(), get = vi.fn();
    expect(() => readClassAttribute(cls, metaclass, undefined, lookup, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
    expect(lookup).not.toHaveBeenCalled();
    expect(() => readClassAttribute(cls, metaclass, { value: "meta", slots: { get, set: () => {} } }, lookup, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
    expect(get).not.toHaveBeenCalled();
    const classLookup = vi.fn(() => ({ value: "class", slots: { get } }));
    expect(() => readClassAttribute(cls, metaclass, undefined, classLookup, new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
    expect(classLookup).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("MRO namespace search", () => {
  it("searches the supplied order once and stops at the first owned binding", () => {
    const a = new Map(), b = new Map([["x", undefined]]), c = new Map([["x", 3]]);
    const lookup = vi.fn((type: Map<string, unknown>, name: string) => type.has(name) ? { value: type.get(name) } : undefined);
    expect(lookupMroAttribute([a, b, c], "x", lookup)).toEqual({ owner: b, value: undefined });
    expect(lookup.mock.calls).toEqual([[a, "x"], [b, "x"]]);
    b.delete("x");
    expect(lookupMroAttribute([a, b, c], "x", lookup)).toEqual({ owner: c, value: 3 });
    expect(lookupMroAttribute([a, b], "x", lookup)).toBeUndefined();
  });

  it("supports opaque names and empty MROs", () => {
    const name = {}, owner = {}, lookup = vi.fn(() => ({ value: null }));
    expect(lookupMroAttribute([], name, lookup)).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    expect(lookupMroAttribute([owner], name, lookup)).toEqual({ owner, value: null });
    expect(lookup).toHaveBeenCalledWith(owner, name);
  });

  it("meters traversal before calling a namespace", () => {
    const lookup = vi.fn(() => undefined);
    expect(() => lookupMroAttribute([{}, {}, {}], "x", lookup, new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
