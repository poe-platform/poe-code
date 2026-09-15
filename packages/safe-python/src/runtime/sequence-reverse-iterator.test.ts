import { describe, expect, it } from "vitest";
import { SequenceReverseIterator, type ReverseSequenceContext } from "./sequence-reverse-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

class IndexEnd extends Error {}
class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: ReverseSequenceContext<unknown> = {
  length: value => BigInt((value as unknown[]).length),
  getItem: (value, index) => { const items = value as unknown[]; if (index >= BigInt(items.length)) throw new IndexEnd(); return items[Number(index)]; },
  isIndexError: error => error instanceof IndexEnd, isStopIteration: error => error instanceof Stop
};

describe("indexed reverse iteration", () => {
  it("captures the initial last index but reads live item values", () => {
    const values = [1, 2, 3], iterator = new SequenceReverseIterator(values, 3n, context, budget());
    values.push(4); values[2] = 9;
    expect(iterator[Symbol.iterator]()).toBe(iterator); expect([...iterator]).toEqual([9, 2, 1]);
  });
  it.each([new IndexEnd(), new Stop()])("permanently exhausts on stop-like item errors", failure => {
    let calls = 0;
    const iterator = new SequenceReverseIterator({}, 3n, { ...context, getItem: () => { calls++; throw failure; } }, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().done).toBe(true); expect(iterator.lengthHint()).toBe(0n); expect(calls).toBe(1);
  });
  it("propagates other item errors once, then stays exhausted", () => {
    const failure = new Error("item failed"), iterator = new SequenceReverseIterator({}, 2n, { ...context, getItem: () => { throw failure; } }, budget());
    expect(() => iterator.next()).toThrow(failure); expect(iterator.next().done).toBe(true); expect(iterator.lengthHint()).toBe(0n);
  });
  it("does not consult length while advancing", () => {
    const iterator = new SequenceReverseIterator([1, 2], 2n, { ...context, length: () => { throw new Error("unexpected len"); } }, budget());
    expect([...iterator]).toEqual([2, 1]);
  });
  it("allows zero hints to recover if the sequence regrows before next", () => {
    const values = [1, 2, 3], iterator = new SequenceReverseIterator(values, 3n, context, budget());
    values.pop(); expect(iterator.lengthHint()).toBe(0n);
    values.push(9); expect(iterator.lengthHint()).toBe(3n); expect(iterator.next().value).toBe(9);
  });
  it("does not exhaust when the length hint raises", () => {
    const failure = new Error("length failed"), iterator = new SequenceReverseIterator([1, 2], 2n, { ...context, length: () => { throw failure; } }, budget());
    expect(() => iterator.lengthHint()).toThrow(failure); expect(iterator.next().value).toBe(2);
  });
  it("does not read source length for initially empty or exhausted cursors", () => {
    const iterator = new SequenceReverseIterator({}, 0n, { ...context, length: () => { throw new Error("unexpected len"); } }, budget());
    expect(iterator.lengthHint()).toBe(0n); expect(iterator.next().done).toBe(true);
  });
  it("decrements the index captured before a reentrant item callback", () => {
    let nested = false; const indices: bigint[] = [];
    const iterator: SequenceReverseIterator<unknown> = new SequenceReverseIterator({}, 3n, { ...context, getItem: (_value, index) => {
      indices.push(index); if (!nested) { nested = true; iterator.next(); } return index;
    } }, budget());
    expect(iterator.next().value).toBe(2n); expect(iterator.next().value).toBe(1n); expect(indices).toEqual([2n, 2n, 1n]);
  });
  it("captures hint position before a reentrant length callback", () => {
    const iterator: SequenceReverseIterator<unknown> = new SequenceReverseIterator([1, 2, 3], 3n, { ...context, length: value => { iterator.next(); return context.length(value); } }, budget());
    expect(iterator.lengthHint()).toBe(3n); expect(iterator.next().value).toBe(2);
  });
  it("supports undefined as a valid guest value", () => {
    expect(new SequenceReverseIterator([undefined], 1n, context, budget()).next()).toEqual({ done: false, value: undefined });
  });
  it("checks limits after item callbacks before returning", () => {
    let cancelled = false;
    const iterator = new SequenceReverseIterator({}, 1n, { ...context, getItem: () => { cancelled = true; return 1; } },
      { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
  it.each(["index", "stop"])("checks limits after the %s error classifier", phase => {
    let cancelled = false;
    const iterator = new SequenceReverseIterator({}, 1n, { ...context,
      getItem: () => { throw new Stop(); },
      isIndexError: () => { if (phase === "index") cancelled = true; return phase === "index"; },
      isStopIteration: () => { cancelled = true; return true; }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    expect(() => iterator.next()).toThrow(ExecutionLimitError);
  });
});
