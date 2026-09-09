import { describe, expect, it } from "vitest";
import { selectTypeMetaclass } from "./metaclass.js";
import { ExecutionBudget } from "./execution-budget.js";

interface Meta { name: string; mro: readonly Meta[] }
function family() {
  const type: Meta = { name: "type", mro: [] }; type.mro = [type];
  const a: Meta = { name: "A", mro: [] }; a.mro = [a, type];
  const b: Meta = { name: "B", mro: [] }; b.mro = [b, a, type];
  const other: Meta = { name: "A", mro: [] }; other.mro = [other, type];
  return { type, a, b, other };
}

describe("type metaclass selection", () => {
  it("retains the candidate when there are no bases", () => {
    const { a } = family();
    expect(selectTypeMetaclass(a, [], meta => meta.mro)).toBe(a);
  });
  it.each([false, true])("chooses the most derived base metaclass in reverse order %s", reverse => {
    const { type, a, b } = family();
    expect(selectTypeMetaclass(type, reverse ? [b, a] : [a, b], meta => meta.mro)).toBe(b);
  });
  it("retains an explicit candidate that is already more derived", () => {
    const { type, a, b } = family();
    expect(selectTypeMetaclass(b, [type, a, a], meta => meta.mro)).toBe(b);
  });
  it("compares identities instead of names and rejects unrelated candidates", () => {
    const { type, a, other } = family();
    expect(() => selectTypeMetaclass(type, [a, other], meta => meta.mro)).toThrow("metaclass conflict: the metaclass of a derived class must be a (non-strict) subclass of the metaclasses of all its bases");
    expect(() => selectTypeMetaclass(a, [other], meta => meta.mro)).toThrow(expect.objectContaining({ name: "TypeError" }));
  });
  it("accepts a metaclass deriving from multiple candidate metaclasses", () => {
    const { type, a, other } = family();
    const combined: Meta = { name: "Combined", mro: [] }; combined.mro = [combined, a, other, type];
    expect(selectTypeMetaclass(combined, [a, other], meta => meta.mro)).toBe(combined);
  });
  it("does not search later bases to repair an already encountered conflict", () => {
    const { type, a, other } = family();
    const combined: Meta = { name: "Combined", mro: [] }; combined.mro = [combined, a, other, type];
    expect(() => selectTypeMetaclass(type, [a, other, combined], meta => meta.mro)).toThrow(expect.objectContaining({ name: "TypeError" }));
    expect(selectTypeMetaclass(type, [combined, a, other], meta => meta.mro)).toBe(combined);
  });
  it("does not invoke subtype callbacks for identical metaclasses", () => {
    const { type } = family();
    expect(selectTypeMetaclass(type, [type, type], () => { throw new Error("unexpected MRO read"); })).toBe(type);
  });
  it("meters ancestor traversal without changing any candidate", () => {
    const { type, b } = family();
    const before = b.mro;
    expect(() => selectTypeMetaclass(type, [b], meta => meta.mro, new ExecutionBudget({ maxSteps: 3, maxAllocatedBytes: 0 }))).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(b.mro).toBe(before);
  });
  it("checks cancellation even without bases", () => {
    const { type } = family(); const signal = AbortSignal.abort();
    expect(() => selectTypeMetaclass(type, [], meta => meta.mro, new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 0, signal }))).toThrow(expect.objectContaining({ reason: "cancelled" }));
  });
});
