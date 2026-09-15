import { describe, expect, it, vi } from "vitest";
import { readSuperAttribute } from "./super-attributes.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("super attribute lookup", () => {
  it("skips the anchor and earlier classes without reading their namespaces", () => {
    const child = {}, left = {}, right = {}, base = {}, instance = {};
    const lookup = vi.fn(() => ({ value: "right" }));
    expect(readSuperAttribute(left, instance, child, [child, left, right, base], "x", lookup)).toEqual({ value: "right" });
    expect(lookup.mock.calls).toEqual([[right, "x"]]);
  });

  it("continues through absent bindings and returns present undefined", () => {
    const child = {}, left = {}, right = {}, base = {};
    const lookup = vi.fn(type => type === base ? { value: undefined } : undefined);
    expect(readSuperAttribute(left, {}, child, [child, left, right, base], "x", lookup)).toEqual({ value: undefined });
    expect(lookup.mock.calls).toEqual([[right, "x"], [base, "x"]]);
  });

  it.each([false, true])("binds descriptors with class-bound=%s", classBound => {
    const child = {}, anchor = {}, base = {}, instance = classBound ? null : {};
    const get = vi.fn(() => "bound");
    expect(readSuperAttribute(anchor, instance, child, [child, anchor, base], "x", () => ({ value: "raw", slots: { get } }))).toEqual({ value: "bound" });
    expect(get).toHaveBeenCalledWith(instance, child);
  });

  it("does not give data descriptors special priority over earlier plain bindings", () => {
    const child = {}, anchor = {}, first = {}, last = {}, get = vi.fn();
    const lookup = vi.fn(type => type === first ? { value: "first" } : { value: "last", slots: { get, set: () => {} } });
    expect(readSuperAttribute(anchor, {}, child, [child, anchor, first, last], "x", lookup)).toEqual({ value: "first" });
    expect(get).not.toHaveBeenCalled();
  });

  it("returns missing for absent or final anchors and empty MROs", () => {
    const anchor = {}, lookup = vi.fn();
    for (const mro of [[], [{}, {}], [{}, anchor]]) {
      expect(readSuperAttribute(anchor, {}, {}, mro, "x", lookup)).toBeUndefined();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("observes replacement MROs and mutable namespaces on later calls", () => {
    const child = {}, anchor = {}, a = {}, b = {}, name = {};
    let value = "old";
    const lookup = vi.fn(() => ({ value }));
    expect(readSuperAttribute(anchor, {}, child, [child, anchor, a], name, lookup)).toEqual({ value: "old" });
    value = "new";
    expect(readSuperAttribute(anchor, {}, child, [child, anchor, b], name, lookup)).toEqual({ value: "new" });
    expect(lookup.mock.calls).toEqual([[a, name], [b, name]]);
  });

  it("propagates a non-callable getter error without trying later bases", () => {
    const anchor = {}, fault = new TypeError("non-callable getter");
    const lookup = vi.fn(() => ({ value: "raw", slots: { get: () => { throw fault; } } }));
    expect(() => readSuperAttribute(anchor, {}, {}, [anchor, {}, {}], "x", lookup)).toThrow(fault);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("checks every traversal and descriptor dispatch before callbacks", () => {
    const anchor = {}, get = vi.fn(() => "bound"), lookup = vi.fn(() => ({ value: "raw", slots: { get } }));
    for (let maxSteps = 0; maxSteps < 4; maxSteps++) {
      lookup.mockClear(); get.mockClear();
      expect(() => readSuperAttribute(anchor, {}, {}, [anchor, {}], "x", lookup, new ExecutionBudget({ maxSteps, maxAllocatedBytes: 0 }))).toThrow("execution step limit exceeded");
      expect(lookup).toHaveBeenCalledTimes(maxSteps === 3 ? 1 : 0);
      expect(get).not.toHaveBeenCalled();
    }
  });
});
