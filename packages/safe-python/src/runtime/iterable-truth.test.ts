import { describe, expect, it } from "vitest";
import { iterableTruth, type IterableTruthContext } from "./iterable-truth.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

class Stop extends Error {}
const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const context: IterableTruthContext<unknown> = {
  lookupIter: value => () => value, hasNext: () => true,
  next: value => { const item = (value as Iterator<unknown>).next(); if (item.done) throw new Stop(); return item.value; },
  hasSequenceItem: () => false, getItem: () => { throw new Error("unexpected item"); },
  isStopIteration: error => error instanceof Stop, isIndexError: () => false, typeName: () => "Object",
  boolean: value => typeof value === "boolean" ? value : undefined, isNone: value => value === null,
  lookupBool: () => undefined, lookupLength: () => undefined, lookupIndex: () => undefined,
  integer: value => typeof value === "bigint" ? value : undefined, isExactInteger: value => typeof value === "bigint",
  warn: () => { throw new Error("unexpected warning"); }
};

describe("iterable truth reduction", () => {
  it.each(["any", "all"] as const)("uses the empty identity for %s", operation => {
    expect(iterableTruth(operation, [][Symbol.iterator](), context, budget())).toBe(operation === "all");
  });
  it.each(["any", "all"] as const)("short-circuits %s without consuming or closing the tail", operation => {
    const decisive = operation === "any";
    const source = [!decisive, decisive, "tail"][Symbol.iterator]();
    Object.assign(source, { return: () => { throw new Error("unexpected close"); } });
    expect(iterableTruth(operation, source, context, budget())).toBe(decisive);
    expect(source.next().value).toBe("tail");
  });
  it.each(["any", "all"] as const)("returns %s identity after all non-decisive values", operation => {
    const value = operation === "all";
    expect(iterableTruth(operation, [value, value][Symbol.iterator](), context, budget())).toBe(value);
  });
  it("connects length and integer-index truth conversion", () => {
    const first = {}, second = {}, indexed = {};
    const events: string[] = [];
    expect(iterableTruth("any", [first, second][Symbol.iterator](), { ...context,
      lookupLength: value => () => { events.push(value === first ? "first" : "second"); return value === first ? 0n : indexed; },
      lookupIndex: value => value === indexed ? () => { events.push("index"); return 1n; } : undefined
    }, budget())).toBe(true);
    expect(events).toEqual(["first", "second", "index"]);
  });
  it("propagates truth StopIteration rather than treating it as source exhaustion", () => {
    const failure = new Stop(), source = [{}, "tail"][Symbol.iterator]();
    expect(() => iterableTruth("any", source, { ...context, lookupBool: () => () => { throw failure; } }, budget())).toThrow(failure);
    expect(source.next().value).toBe("tail");
  });
  it.each(["iter", "next"] as const)("propagates %s errors", phase => {
    const failure = new Error(phase);
    expect(() => iterableTruth("all", {}, { ...context,
      lookupIter: value => () => { if (phase === "iter") throw failure; return value; }, next: () => { throw failure; }
    }, budget())).toThrow(failure);
  });
  it.each(["any", "all"] as const)("bounds infinite non-decisive %s inputs", operation => {
    expect(() => iterableTruth(operation, {}, { ...context, next: () => operation === "all" },
      new ExecutionBudget({ maxSteps: 30, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
  });
  it("checks cancellation after acquiring a source before consuming it", () => {
    let cancelled = false;
    expect(() => iterableTruth("any", {}, { ...context, lookupIter: value => () => { cancelled = true; return value; },
      next: () => { throw new Error("unexpected next"); }
    }, { checkpoint: () => { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  });
});
