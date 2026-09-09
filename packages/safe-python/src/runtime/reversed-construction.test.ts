import { describe, expect, it } from "vitest";
import { constructReversed, type ReversedConstructionContext } from "./reversed-construction.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: ReversedConstructionContext<unknown> = {
  lookupReversed: () => undefined, hasSequenceItem: () => true, typeName: () => "Source",
  length: value => BigInt((value as unknown[]).length), getItem: (value, index) => (value as unknown[])[Number(index)],
  isIndexError: () => false, isStopIteration: () => false, wrap: iterator => iterator
};

describe("guest reversed construction", () => {
  it.each([7, null, undefined])("returns custom method result %s without validating iterator shape", result => {
    expect(constructReversed([{}], new Map(), { ...context, lookupReversed: () => () => result,
      hasSequenceItem: () => { throw new Error("unexpected sequence check"); }
    }, budget())).toBe(result);
  });
  it("rejects disabled methods before sequence fallback", () => {
    expect(() => constructReversed([[]], new Map(), { ...context, lookupReversed: () => null,
      length: () => { throw new Error("unexpected length"); }
    }, budget())).toThrow("'Source' object is not reversible");
  });
  it("rejects non-sequences before querying length", () => {
    expect(() => constructReversed([{}], new Map(), { ...context, hasSequenceItem: () => false,
      length: () => { throw new Error("unexpected length"); }
    }, budget())).toThrow("'Source' object is not reversible");
  });
  it("acquires length eagerly and gets items only during iteration", () => {
    const events: string[] = [];
    const result = constructReversed([[1, 2, 3]], new Map(), { ...context,
      length: value => { events.push("len"); return context.length(value); },
      getItem: (value, index) => { events.push(String(index)); return context.getItem(value, index); }
    }, budget()) as IterableIterator<unknown>;
    expect(events).toEqual(["len"]); expect([...result]).toEqual([3, 2, 1]); expect(events).toEqual(["len", "2", "1", "0"]);
  });
  it.each(["lookup", "call", "length"])("propagates %s failure without wrapping", phase => {
    const failure = new Error(phase);
    expect(() => constructReversed([[]], new Map(), { ...context,
      lookupReversed: () => { if (phase === "lookup") throw failure; return phase === "call" ? () => { throw failure; } : undefined; },
      length: () => { throw failure; }, wrap: () => { throw new Error("unexpected wrap"); }
    }, budget())).toThrow(failure);
  });
  it.each([0, 2])("rejects %s positional arguments", count => {
    expect(() => constructReversed(Array(count).fill(null), new Map(), context, budget())).toThrow(`reversed expected 1 argument, got ${count}`);
  });
  it("rejects keywords before arity", () => {
    expect(() => constructReversed([], new Map([["sequence", []]]), context, budget())).toThrow("reversed() takes no keyword arguments");
  });
  it("preserves missing length diagnostics for eligible sequences", () => {
    const failure = new PythonRuntimeError("TypeError", "object of type 'Source' has no len()");
    expect(() => constructReversed([{}], new Map(), { ...context, length: () => { throw failure; } }, budget())).toThrow(failure);
  });
  it("checks cancellation after a custom method returns", () => {
    let cancelled = false;
    expect(() => constructReversed([{}], new Map(), { ...context, lookupReversed: () => () => { cancelled = true; return 1; } },
      { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
  it("checks cancellation after formatting the non-reversible type name", () => {
    let cancelled = false;
    expect(() => constructReversed([{}], new Map(), { ...context,
      hasSequenceItem: () => false, typeName: () => { cancelled = true; return "Source"; }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
