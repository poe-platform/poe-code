import { describe, expect, it } from "vitest";
import { CallableIterator, type CallableIterationContext } from "./callable-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: CallableIterationContext<unknown> = {
  isCallable: value => typeof value === "function",
  call: value => (value as () => unknown)(), equal: (a, b) => a === b,
  isStopIteration: error => error instanceof Stop
};

describe("callable sentinel iteration", () => {
  it("rejects a non-callable before creating an active iterator", () => {
    expect(() => new CallableIterator(1, 9, context, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: "iter(v, w): v must be callable" }));
  });
  it("calls lazily and stops permanently when the sentinel matches", () => {
    let calls = 0;
    const iterator = new CallableIterator(() => ++calls, 3, context, budget());
    expect(calls).toBe(0); expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect([...iterator]).toEqual([1, 2]); expect(calls).toBe(3); expect(iterator.next().done).toBe(true); expect(calls).toBe(3);
  });
  it("compares sentinel first and skips equality for identical results", () => {
    const sentinel = {}, calls: unknown[] = []; let n = 0;
    const iterator = new CallableIterator(() => n++ === 0 ? 1 : sentinel, sentinel, { ...context,
      equal: (a, b) => { calls.push([a, b]); return false; }
    }, budget());
    expect([...iterator]).toEqual([1]); expect(calls).toEqual([[sentinel, 1]]);
  });
  it("latches exhaustion after callable StopIteration", () => {
    let calls = 0;
    const iterator = new CallableIterator(() => { calls++; throw new Stop(); }, null, context, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().done).toBe(true); expect(calls).toBe(1);
  });
  it("does not latch exhaustion after equality StopIteration", () => {
    let calls = 0;
    const iterator = new CallableIterator(() => ++calls, null, { ...context, equal: () => { if (calls === 1) throw new Stop(); return false; } }, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next()).toEqual({ done: false, value: 2 });
  });
  it("allows retry after non-terminal callable errors", () => {
    let calls = 0; const failure = new Error("call failed");
    const iterator = new CallableIterator(() => { if (++calls === 1) throw failure; return 2; }, null, context, budget());
    expect(() => iterator.next()).toThrow(failure); expect(iterator.next().value).toBe(2);
  });
  it("allows retry after equality errors without reusing the previous result", () => {
    let calls = 0; const failure = new Error("equal failed");
    const iterator = new CallableIterator(() => ++calls, null, { ...context, equal: () => { if (calls === 1) throw failure; return false; } }, budget());
    expect(() => iterator.next()).toThrow(failure); expect(iterator.next().value).toBe(2);
  });
  it("can yield undefined without confusing it with completion", () => {
    const iterator = new CallableIterator(() => undefined, null, context, budget());
    expect(iterator.next()).toEqual({ done: false, value: undefined });
  });
  it("discards an outer call result when a nested call exhausted the iterator", () => {
    let calls = 0;
    const sentinel = {};
    const iterator: CallableIterator<unknown> = new CallableIterator(() => {
      if (++calls === 1) { expect(iterator.next().done).toBe(true); return 9; } return sentinel;
    }, sentinel, context, budget());
    expect(iterator.next().done).toBe(true); expect(calls).toBe(2);
  });
  it("preserves an unequal outer result even if equality reentrantly exhausts the iterator", () => {
    let calls = 0; const sentinel = {};
    const iterator: CallableIterator<unknown> = new CallableIterator(() => ++calls === 1 ? 9 : sentinel, sentinel, { ...context,
      equal: () => { expect(iterator.next().done).toBe(true); return false; }
    }, budget());
    expect(iterator.next()).toEqual({ done: false, value: 9 }); expect(iterator.next().done).toBe(true);
  });
  it("checks limits after equality before committing terminal state", () => {
    let reject = false, calls = 0;
    const iterator = new CallableIterator(() => ++calls, null, { ...context, equal: () => { reject = true; return true; } }, {
      checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); }
    });
    expect(() => iterator.next()).toThrow(ExecutionLimitError); reject = false;
    expect(() => iterator.next()).toThrow(ExecutionLimitError); expect(calls).toBe(2);
  });
});
