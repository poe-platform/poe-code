import { describe, expect, it } from "vitest";
import { extendList, type ListExtensionContext } from "./list-extension.js";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
interface Source { iter?: () => unknown; next?: () => unknown; len?: () => bigint; hint?: () => unknown; get?: (index: bigint) => unknown }
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: ListExtensionContext<unknown> = {
  exactList: value => value instanceof ListStorage ? value : undefined,
  lookupIter: value => (value as Source).iter,
  hasNext: value => typeof value === "object" && value !== null && "next" in value,
  next: value => (value as Source).next!(),
  hasSequenceItem: value => (value as Source).get !== undefined,
  getItem: (value, index) => (value as Source).get!(index),
  isStopIteration: error => error instanceof Stop,
  isIndexError: error => error instanceof PythonRuntimeError && error.name === "IndexError",
  length: value => (value as Source).len?.(), lookupHint: value => (value as Source).hint,
  integer: value => typeof value === "bigint" ? value : undefined,
  isNotImplemented: () => false,
  isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
  typeName: () => "Source"
};

describe("guest iterable list extension", () => {
  it("takes the exact-list path including finite self-extension without guest lookups", () => {
    const target = new ListStorage<unknown>([1, 2], budget());
    extendList(target, target, { ...context, lookupIter: () => { throw new Error("unexpected lookup"); } }, budget());
    expect(target.snapshot()).toEqual([1, 2, 1, 2]);
  });
  it("gets the iterator before querying the original source length", () => {
    const events: string[] = [], target = new ListStorage<unknown>([], budget()); let calls = 0;
    const iterator = { next: () => { events.push("next"); if (calls++ === 1) throw new Stop(); return 7; },
      len: () => { throw new Error("wrong length target"); } };
    extendList(target, { iter: () => { events.push("iter"); return iterator; }, len: () => { events.push("len"); return 1n; } }, context, budget());
    expect(events).toEqual(["iter", "len", "next", "next"]); expect(target.snapshot()).toEqual([7]);
  });
  it("queries a fallback hint after length TypeError and consumes until exhaustion", () => {
    const target = new ListStorage<unknown>([], budget()); let calls = 0, hints = 0;
    extendList(target, { iter: () => ({ next: () => { if (calls++ === 3) throw new Stop(); return calls; } }),
      len: () => { throw new PythonRuntimeError("TypeError", "no len"); }, hint: () => { hints++; return 1n; } }, context, budget());
    expect(hints).toBe(1); expect(target.snapshot()).toEqual([1, 2, 3]);
  });
  it("runs the same preparation for indexed sequence fallback", () => {
    const target = new ListStorage<unknown>([], budget()), events: unknown[] = [];
    extendList(target, { len: () => { events.push("len"); return 2n; }, get: (i: bigint) => {
      events.push(i); if (i === 2n) throw new PythonRuntimeError("IndexError", "end"); return i;
    } }, context, budget());
    expect(events).toEqual(["len", 0n, 1n, 2n]); expect(target.snapshot()).toEqual([0n, 1n]);
  });
  it("does not call next after hint validation fails", () => {
    const target = new ListStorage<unknown>([0], budget());
    expect(() => extendList(target, { iter: () => ({ next: () => { throw new Error("unexpected next"); } }), hint: () => -1n }, context, budget()))
      .toThrow(expect.objectContaining({ name: "ValueError", message: "__length_hint__() should return >= 0" }));
    expect(target.snapshot()).toEqual([0]);
  });
  it("preserves target mutations made during iterator and hint preparation", () => {
    const target = new ListStorage<unknown>([0], budget()); let calls = 0;
    extendList(target, { iter: () => { target.clear(); return { next: () => { if (calls++) throw new Stop(); return 3; } }; },
      hint: () => { target.append(2); return 1n; } }, context, budget());
    expect(target.snapshot()).toEqual([2, 3]);
  });
  it("preserves partial extension on next failure", () => {
    const target = new ListStorage<unknown>([0], budget()), failure = new Error("next failed"); let calls = 0;
    expect(() => extendList(target, { iter: () => ({ next: () => { if (calls++) throw failure; return 1; } }) }, context, budget())).toThrow(failure);
    expect(target.snapshot()).toEqual([0, 1]);
  });
  it("does not preallocate guest-controlled advisory capacity", () => {
    const meter = budget(), target = new ListStorage<unknown>([], meter);
    extendList(target, { iter: () => ({ next: () => { throw new Stop(); } }), hint: () => (1n << 63n) - 1n }, context, meter);
    expect(target.length).toBe(0); expect(meter.usage.allocatedBytes).toBeLessThan(1000);
  });
  it("bounds an infinite guest iterator through the consumer's meter", () => {
    const meter = new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 10000 }), target = new ListStorage<unknown>([], meter);
    expect(() => extendList(target, { iter: () => ({ next: () => 1 }) }, context, meter)).toThrow(ExecutionLimitError);
  });
});
