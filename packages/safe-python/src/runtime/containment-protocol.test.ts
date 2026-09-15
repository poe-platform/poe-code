import { expect, it } from "vitest";
import { protocolContains, type ContainmentContext } from "./containment-protocol.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const source = {}, needle = {}, member = {}, events: string[] = [];
  const stop = new PythonRuntimeError("StopIteration", "done"); let pulls = 0;
  const context: ContainmentContext<unknown> = {
    lookupContains: () => undefined, lookupIter: () => () => source, hasNext: () => true,
    next() { events.push("next"); if (pulls++ > 0) throw stop; return member; },
    hasSequenceItem: () => false, getItem: () => { throw Error("unexpected item"); },
    isStopIteration: error => error === stop, isIndexError: () => false,
    isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError", typeName: () => "Guest",
    equal(a, b) { expect(a).toBe(member); expect(b).toBe(needle); events.push("equal"); return false; },
    truth(value) { events.push("truth"); return Boolean(value); }
  };
  return { meter, source, needle, member, events, context, run: () => protocolContains(needle, source, context, meter) };
}
it("uses contains and truth before any iteration, without special-casing results", () => {
  const { context, run, needle, events } = fixture(), result = {};
  context.lookupContains = () => value => { expect(value).toBe(needle); events.push("contains"); return result; };
  context.lookupIter = () => { throw Error("must not iterate"); };
  context.truth = value => { expect(value).toBe(result); events.push("truth"); return false; };
  expect(run()).toBe(false); expect(events).toEqual(["contains", "truth"]);
});
it("rejects an explicitly disabled contains slot without iteration fallback", () => {
  const { context, run } = fixture(); context.lookupContains = () => null;
  context.lookupIter = () => { throw Error("must not iterate"); };
  expect(run).toThrow("'Guest' object is not a container");
});
it("falls back to iterator member-first equality and consumes normal exhaustion", () => {
  const { run, events } = fixture();
  expect(run()).toBe(false); expect(events).toEqual(["next", "equal", "truth", "next"]);
});
it("short-circuits identity without calling equality or truth", () => {
  const { context, needle, run, events } = fixture();
  context.next = () => { events.push("next"); return needle; };
  expect(run()).toBe(true); expect(events).toEqual(["next"]);
});
it("supports legacy indexed iteration", () => {
  const { context, needle, run } = fixture(), indices: bigint[] = [];
  context.lookupIter = () => undefined; context.hasSequenceItem = () => true;
  context.getItem = (_source, index) => { indices.push(index); return needle; };
  expect(run()).toBe(true); expect(indices).toEqual([0n]);
});
it("rewrites only iterator-acquisition TypeErrors", () => {
  for (const stage of ["iter", "next", "equal", "truth", "contains"]) {
    const { context, run } = fixture(), error = new PythonRuntimeError("TypeError", "guest failure");
    if (stage === "iter") context.lookupIter = () => () => { throw error; };
    if (stage === "next") context.next = () => { throw error; };
    if (stage === "equal") context.equal = () => { throw error; };
    if (stage === "truth") context.truth = () => { throw error; };
    if (stage === "contains") context.lookupContains = () => () => { throw error; };
    expect(run).toThrow(stage === "iter" ? "argument of type 'Guest' is not a container or iterable" : error);
  }
});
it("checks cancellation after contains and truth before returning", () => {
  for (const stage of ["contains", "truth"]) {
    const { context, needle, source } = fixture(); let cancelled = false;
    context.lookupContains = () => () => { if (stage === "contains") cancelled = true; return true; };
    context.truth = () => { cancelled = true; return true; };
    expect(() => protocolContains(needle, source, context, { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } })).toThrow(ExecutionLimitError);
  }
});
