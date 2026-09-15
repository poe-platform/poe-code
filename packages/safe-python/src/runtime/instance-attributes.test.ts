import { describe, expect, it, vi } from "vitest";
import { readInstanceAttribute, writeInstanceAttribute, deleteInstanceAttribute, type ClassAttribute } from "./instance-attributes.js";
import { ExecutionBudget } from "./execution-budget.js";

const instance = {}, owner = {};

describe("instance descriptor precedence", () => {
  it.each(Array.from({ length: 8 }, (_, mask) => mask))("implements read precedence for descriptor mask %i", mask => {
    const get = vi.fn(() => "bound"), set = vi.fn(), del = vi.fn();
    const attribute: ClassAttribute<object, string, object> = {
      value: "descriptor", slots: { get: mask & 1 ? get : undefined, set: mask & 2 ? set : undefined, delete: mask & 4 ? del : undefined }
    };
    const lookup = vi.fn(() => ({ value: "instance" }));
    const dataGetter = Boolean((mask & 1) && (mask & 6));
    expect(readInstanceAttribute(instance, owner, attribute, lookup)).toEqual({ value: dataGetter ? "bound" : "instance" });
    expect(lookup).toHaveBeenCalledTimes(dataGetter ? 0 : 1);
    get.mockClear();
    expect(readInstanceAttribute(instance, owner, attribute, () => undefined)).toEqual({ value: mask & 1 ? "bound" : "descriptor" });
    if (mask & 1) expect(get).toHaveBeenCalledWith(instance, owner);
  });

  it("distinguishes missing attributes from present undefined values", () => {
    expect(readInstanceAttribute(instance, owner, undefined, () => undefined)).toBeUndefined();
    expect(readInstanceAttribute(instance, owner, undefined, () => ({ value: undefined }))).toEqual({ value: undefined });
  });

  it("returns instance-held descriptor objects without binding them", () => {
    const value = { get: () => { throw new Error("must not bind instance value"); } };
    expect(readInstanceAttribute(instance, owner, undefined, () => ({ value }))).toEqual({ value });
  });

  it("propagates getter errors without falling back to instance storage", () => {
    const fault = new Error("descriptor failed"), lookup = vi.fn();
    const attribute = { value: "descriptor", slots: { get: () => { throw fault; }, set: () => {} } };
    expect(() => readInstanceAttribute(instance, owner, attribute, lookup)).toThrow(fault);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("routes assignment and deletion through data descriptors", () => {
    const set = vi.fn(), del = vi.fn(), fallback = vi.fn();
    const attribute = { value: "descriptor", slots: { set, delete: del } };
    writeInstanceAttribute(instance, attribute, "new", fallback);
    deleteInstanceAttribute(instance, attribute, fallback);
    expect(set).toHaveBeenCalledWith(instance, "new");
    expect(del).toHaveBeenCalledWith(instance);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("rejects missing data-descriptor mutation slots rather than using the dictionary", () => {
    const fallback = vi.fn();
    expect(() => writeInstanceAttribute(instance, { value: "d", slots: { delete: () => {} } }, "new", fallback)).toThrow(expect.objectContaining({ name: "AttributeError", message: "__set__" }));
    expect(() => deleteInstanceAttribute(instance, { value: "d", slots: { set: () => {} } }, fallback)).toThrow(expect.objectContaining({ name: "AttributeError", message: "__delete__" }));
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses instance storage for plain and non-data class attributes", () => {
    const write = vi.fn(), del = vi.fn();
    const attribute = { value: "d", slots: { get: () => "bound" } };
    writeInstanceAttribute(instance, attribute, "new", write);
    deleteInstanceAttribute(instance, attribute, del);
    expect(write).toHaveBeenCalledWith("new");
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("checks dispatch budgets before callbacks can mutate state", () => {
    const set = vi.fn(), fallback = vi.fn();
    expect(() => writeInstanceAttribute(instance, { value: "d", slots: { set } }, "new", fallback, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 0 }))).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(set).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
  });
});
