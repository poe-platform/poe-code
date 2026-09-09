import { describe, expect, it } from "vitest";
import { sortedIterable } from "./sorted-iterable.js";
import type { ListExtensionContext } from "./list-extension.js";
import { ListStorage } from "./list-storage.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { bindSortOptions } from "./sort-options.js";

class Stop extends Error {}
interface Source { iter?: () => unknown; next?: () => unknown; len?: () => bigint }
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: ListExtensionContext<unknown> = {
  exactList: value => value instanceof ListStorage ? value : undefined,
  lookupIter: value => (value as Source).iter,
  hasNext: value => typeof value === "object" && value !== null && "next" in value,
  next: value => (value as Source).next!(), hasSequenceItem: () => false,
  getItem: () => { throw new Error("unexpected getitem"); },
  isStopIteration: error => error instanceof Stop, isIndexError: () => false,
  length: value => (value as Source).len?.(), lookupHint: () => undefined,
  integer: value => typeof value === "bigint" ? value : undefined,
  isNotImplemented: () => false, isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
  typeName: () => "Source"
};
const numeric = { key: (value: unknown) => Number(value), less: (a: number, b: number) => a < b };

describe("sorted iterable integration", () => {
  it("composes guest sort-option binding with copied-list sorting", () => {
    const source = new ListStorage<unknown>([3, 1, 2], budget()), events: unknown[] = [], meter = budget();
    const key = (value: unknown) => { events.push(value); return -Number(value); };
    const result = sortedIterable(source, context, () => bindSortOptions([], new Map<string, unknown>([["key", key], ["reverse", true]]), {
      isNone: value => value === null,
      truth: () => { events.push("reverse"); return true; },
      callKey: (callable, value) => (callable as typeof key)(value), less: (a, b) => Number(a) < Number(b)
    }, meter), meter);
    expect(result.snapshot()).toEqual([1, 2, 3]); expect(source.snapshot()).toEqual([3, 1, 2]);
    expect(events).toEqual(["reverse", 3, 1, 2]);
  });
  it("copies an exact list before sorting and leaves its slots unchanged", () => {
    const source = new ListStorage<unknown>([3, 1, 2], budget());
    const result = sortedIterable(source, context, () => numeric, budget());
    expect(result).not.toBe(source); expect(result.snapshot()).toEqual([1, 2, 3]); expect(source.snapshot()).toEqual([3, 1, 2]);
  });
  it("finishes iteration before preparing sort options or evaluating keys", () => {
    const events: string[] = []; let calls = 0;
    const result = sortedIterable({ iter: () => { events.push("iter"); return { next: () => {
      events.push("next"); if (calls++ === 2) throw new Stop(); return 3 - calls;
    } }; }, len: () => { events.push("len"); return 2n; } }, context, () => {
      events.push("options"); return { ...numeric, key: value => { events.push("key"); return Number(value); } };
    }, budget());
    expect(result.snapshot()).toEqual([1, 2]);
    expect(events).toEqual(["iter", "len", "next", "next", "next", "options", "key", "key"]);
  });
  it("does not prepare options when iterable consumption fails", () => {
    const failure = new Error("next failed"); let prepared = false;
    expect(() => sortedIterable({ iter: () => ({ next: () => { throw failure; } }) }, context,
      () => { prepared = true; return numeric; }, budget())).toThrow(failure);
    expect(prepared).toBe(false);
  });
  it("exhausts a source even when subsequent sort-option validation fails", () => {
    let calls = 0; const failure = new PythonRuntimeError("TypeError", "bad sort option");
    expect(() => sortedIterable({ iter: () => ({ next: () => { if (calls++ === 2) throw new Stop(); return calls; } }) }, context,
      () => { throw failure; }, budget())).toThrow(failure);
    expect(calls).toBe(3);
  });
  it("does not call a key for an empty iterable", () => {
    const result = sortedIterable(new ListStorage([], budget()), context, () => ({ ...numeric,
      key: () => { throw new PythonRuntimeError("TypeError", "key is not callable"); }
    }), budget());
    expect(result.snapshot()).toEqual([]);
  });
  it("retains equal-key element identities in reverse sorting", () => {
    const a = { k: 1 }, b = { k: 2 }, c = { k: 1 }, source = new ListStorage<unknown>([a, b, c], budget());
    const result = sortedIterable(source, context, () => ({ key: value => (value as { k: number }).k, less: numeric.less, reverse: true }), budget());
    expect(result.get(0n)).toBe(b); expect(result.get(1n)).toBe(a); expect(result.get(2n)).toBe(c);
  });
  it("separates copied result slots from mutations of the source during key calls", () => {
    const source = new ListStorage<unknown>([3, 1, 2], budget());
    const result = sortedIterable(source, context, () => ({ ...numeric, key: value => { source.clear(); return Number(value); } }), budget());
    expect(source.snapshot()).toEqual([]); expect(result.snapshot()).toEqual([1, 2, 3]);
  });
  it("checks resource limits after preparing options", () => {
    let reject = false;
    expect(() => sortedIterable(new ListStorage([], budget()), context, () => { reject = true; return numeric; }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
});
