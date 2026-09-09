import { describe, expect, it } from "vitest";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
interface ObjectValue { iter?: () => unknown; next?: () => unknown; get?: (index: bigint) => unknown }
const context: IterationContext<unknown> = {
  lookupIter: value => (value as ObjectValue).iter,
  hasNext: value => typeof value === "object" && value !== null && "next" in value,
  next: value => (value as ObjectValue).next!(),
  hasSequenceItem: value => (value as ObjectValue).get !== undefined,
  getItem: (value, index) => (value as ObjectValue).get!(index),
  isStopIteration: error => error instanceof Stop,
  isIndexError: error => error instanceof PythonRuntimeError && error.name === "IndexError",
  typeName: () => "X"
};

describe("guest protocol iterator adapters", () => {
  it.each([undefined, 0n, 1n, 5n])("gets a legacy cursor's remaining length from source length %s", length => {
    let calls = 0;
    const iterator = new ProtocolIterator({ get: (index: bigint) => { if (index === 2n) throw new Stop(); return index; } }, {
      ...context,
      hints: {
        length: () => { calls++; return length; },
        lookupHint: () => { throw Error("must not consult source hint"); },
        integer: () => undefined, isNotImplemented: () => false, isTypeError: () => false, typeName: () => "X"
      }
    }, budget());
    iterator.next();
    expect(iterator.lengthHint(8n)).toBe(length === undefined ? 8n : length > 1n ? length - 1n : 0n);
    iterator.next(); iterator.next();
    expect(iterator.lengthHint(8n)).toBe(0n); expect(calls).toBe(1);
  });
  it.each(["TypeError", "ValueError", "negative", "overflow"])("handles legacy cursor length failure %s", mode => {
    const failure = new PythonRuntimeError(mode, "length failed");
    const iterator = new ProtocolIterator({ get: () => 1 }, {
      ...context,
      hints: {
        length: () => { if (mode === "negative") return -1n; if (mode === "overflow") return 1n << 63n; throw failure; },
        lookupHint: () => { throw Error("must not consult source hint"); },
        integer: () => undefined, isNotImplemented: () => false,
        isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError", typeName: () => "X"
      }
    }, budget());
    if (mode === "TypeError") expect(iterator.lengthHint(8n)).toBe(8n);
    else expect(() => iterator.lengthHint(8n)).toThrow(mode === "negative" ? "__len__() should return >= 0" : mode === "overflow" ? "cannot fit 'int' into an index-sized integer" : failure);
  });
  it("keeps a legacy sequence cursor's position when reacquired", () => {
    const iterator = new ProtocolIterator({ get: (index: bigint) => index }, context, budget());
    expect(iterator.next().value).toBe(0n);
    expect(iterator.reacquire()).toBe(iterator);
    expect(iterator.next().value).toBe(1n);
  });
  it("requires iterability of a guest cursor only when reacquired", () => {
    const iterator = new ProtocolIterator({ iter: () => ({ next: () => 7 }) }, context, budget());
    expect(iterator.next().value).toBe(7);
    expect(() => iterator.reacquire()).toThrow("'X' object is not iterable");
  });
  it("validates the replacement cursor returned during reacquisition", () => {
    const iterator = new ProtocolIterator({ iter: () => ({ next: () => 7, iter: () => ({}) }) }, context, budget());
    expect(() => iterator.reacquire()).toThrow("iter() returned non-iterator of type 'X'");
  });
  it("calls iter once and validates next without calling iter on the result", () => {
    let calls = 0, nextCalls = 0;
    const result = { next: () => ++nextCalls, iter: () => { throw new Error("unexpected second iter"); } };
    const iterator = new ProtocolIterator({ iter: () => { calls++; return result; } }, context, budget());
    expect(iterator[Symbol.iterator]()).toBe(iterator);
    expect(iterator.next()).toEqual({ done: false, value: 1 }); expect(calls).toBe(1);
  });
  it("does not require iter on an iterator returned by iter", () => {
    const iterator = new ProtocolIterator({ iter: () => ({ next: () => 7 }) }, context, budget());
    expect(iterator.next()).toEqual({ done: false, value: 7 });
  });
  it("rejects a non-iterator result without sequence fallback", () => {
    expect(() => new ProtocolIterator({ iter: () => ({}), get: () => 1 }, context, budget())).toThrow(expect.objectContaining({
      name: "TypeError", message: "iter() returned non-iterator of type 'X'"
    }));
  });
  it("preserves iter call failures rather than falling back to getitem", () => {
    const failure = new PythonRuntimeError("TypeError", "iteration disabled");
    expect(() => new ProtocolIterator({ iter: () => { throw failure; }, get: () => 1 }, context, budget())).toThrow(failure);
  });
  it("rejects objects with neither protocol", () => {
    expect(() => new ProtocolIterator({}, context, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: "'X' object is not iterable" }));
  });
  it("does not force sticky exhaustion on arbitrary guest iterators", () => {
    let calls = 0;
    const iterator = new ProtocolIterator({ iter: () => ({ next: () => { if (++calls === 1) throw new Stop(); return 9; } }) }, context, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next()).toEqual({ done: false, value: 9 });
  });
  it("preserves returned undefined as an item", () => {
    const iterator = new ProtocolIterator({ iter: () => ({ next: () => undefined }) }, context, budget());
    expect(iterator.next()).toEqual({ done: false, value: undefined });
  });
  it("uses successive integer indices for the legacy sequence protocol", () => {
    const calls: bigint[] = [];
    const iterator = new ProtocolIterator({ get: (index: bigint) => {
      calls.push(index); if (index === 2n) throw new PythonRuntimeError("IndexError", "end"); return Number(index) + 10;
    } }, context, budget());
    expect([...iterator]).toEqual([10, 11]); expect(calls).toEqual([0n, 1n, 2n]);
    expect(iterator.next().done).toBe(true); expect(calls.length).toBe(3);
  });
  it("also latches sequence exhaustion on StopIteration", () => {
    let calls = 0;
    const iterator = new ProtocolIterator({ get: () => { calls++; throw new Stop(); } }, context, budget());
    expect(iterator.next().done).toBe(true); expect(iterator.next().done).toBe(true); expect(calls).toBe(1);
  });
  it("retries the same sequence index after other errors", () => {
    const calls: bigint[] = [], failure = new Error("item failed");
    const iterator = new ProtocolIterator({ get: (index: bigint) => { calls.push(index); if (calls.length === 1) throw failure; return index; } }, context, budget());
    expect(() => iterator.next()).toThrow(failure); expect(iterator.next().value).toBe(0n); expect(calls).toEqual([0n, 0n]);
  });
  it("does not swallow IndexError from guest next", () => {
    const failure = new PythonRuntimeError("IndexError", "next failed");
    const iterator = new ProtocolIterator({ iter: () => ({ next: () => { throw failure; } }) }, context, budget());
    expect(() => iterator.next()).toThrow(failure);
  });
  it("resolves guest next dispatch on every step", () => {
    const source = { next: () => 1 }, iterator = new ProtocolIterator({ iter: () => source }, context, budget());
    expect(iterator.next().value).toBe(1); source.next = () => 2; expect(iterator.next().value).toBe(2);
  });
  it("checks the meter after getitem before advancing the index", () => {
    let reject = false; const calls: bigint[] = [];
    const iterator = new ProtocolIterator({ get: (index: bigint) => { calls.push(index); reject = true; return 1; } }, context,
      { checkpoint: () => { if (reject) throw new ExecutionLimitError("cancelled"); } });
    expect(() => iterator.next()).toThrow(ExecutionLimitError); reject = false;
    expect(() => iterator.next()).toThrow(ExecutionLimitError); expect(calls).toEqual([0n, 0n]);
  });
});
