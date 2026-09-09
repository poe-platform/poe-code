import { describe, expect, it } from "vitest";
import { zipIterables, type ZipIterableContext } from "./zip-iterables.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

class Stop extends Error {}
interface Source { values: unknown[]; index: number; id: number }
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const source = (id: number, ...values: unknown[]): Source => ({ id, values, index: 0 });
const context: ZipIterableContext<unknown, readonly unknown[]> = {
  lookupIter: value => () => value, hasNext: () => true,
  next: value => { const item = value as Source; if (item.index === item.values.length) throw new Stop(); return item.values[item.index++]; },
  hasSequenceItem: () => false, getItem: () => { throw new Error("unexpected item"); },
  isStopIteration: error => error instanceof Stop, isIndexError: () => false, typeName: () => "Source",
  truth: value => Boolean(value), tuple: values => values
};

describe("guest zip construction", () => {
  it("converts strict before eagerly creating iterators left to right", () => {
    const events: unknown[] = [];
    const iterator = zipIterables([source(0, 1), source(1, 2)], new Map([["strict", true]]), {
      ...context, truth: value => { events.push("truth"); return Boolean(value); },
      lookupIter: value => () => { events.push((value as Source).id); return value; }
    }, budget());
    expect(events).toEqual(["truth", 0, 1]); expect([...iterator]).toEqual([[1, 2]]);
  });
  it("does not consume values during iterator creation", () => {
    const first = source(0, 1), second = source(1, 2);
    const iterator = zipIterables([first, second], new Map(), context, budget());
    expect(first.index).toBe(0); expect(second.index).toBe(0); expect(iterator.next().value).toEqual([1, 2]);
  });
  it("rejects too many keywords before truth or iterable callbacks", () => {
    expect(() => zipIterables([source(0)], new Map([["strict", true], ["x", true]]), {
      ...context, truth: () => { throw new Error("unexpected truth"); }, lookupIter: () => { throw new Error("unexpected iter"); }
    }, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: "zip() takes at most 1 keyword argument (2 given)" }));
  });
  it("suggests the strict keyword before creating iterators", () => {
    expect(() => zipIterables([], new Map([["stric", true]]), context, budget())).toThrow(expect.objectContaining({
      message: "zip() got an unexpected keyword argument 'stric'. Did you mean 'strict'?"
    }));
  });
  it("converts strict even when there are no inputs", () => {
    let calls = 0;
    const iterator = zipIterables([], new Map([["strict", true]]), { ...context, truth: () => { calls++; return true; } }, budget());
    expect(calls).toBe(1); expect(iterator.next().done).toBe(true);
  });
  it("stops eager iterator creation at the first failure", () => {
    const events: number[] = [], failure = new PythonRuntimeError("TypeError", "bad iterable");
    expect(() => zipIterables([source(0), source(1), source(2)], new Map(), { ...context, lookupIter: value => () => {
      const item = value as Source; events.push(item.id); if (item.id === 1) throw failure; return value;
    } }, budget())).toThrow(failure); expect(events).toEqual([0, 1]);
  });
  it("connects strict length mismatch to guest protocol inputs", () => {
    const iterator = zipIterables([source(0, 1, 2), source(1, 3)], new Map([["strict", true]]), context, budget());
    expect(iterator.next().value).toEqual([1, 3]); expect(() => iterator.next()).toThrow("argument 2 is shorter than argument 1");
  });
  it("preserves context binding for tuple construction", () => {
    const ctx = { ...context, marker: 9, tuple(values: readonly unknown[]) { return [this.marker, ...values]; } };
    expect(zipIterables([source(0, 1)], new Map(), ctx, budget()).next().value).toEqual([9, 1]);
  });
  it("checks limits after truth conversion before creating an input iterator", () => {
    let reject = false;
    expect(() => zipIterables([source(0)], new Map([["strict", true]]), { ...context, truth: () => { reject = true; return true; } }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    })).toThrow(ExecutionLimitError);
  });
});
