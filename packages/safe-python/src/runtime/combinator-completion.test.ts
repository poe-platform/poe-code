import { expect, it } from "vitest";
import { EnumerateIterator } from "./enumerate-iterator.js";
import { FilterIterator } from "./filter-iterator.js";
import { MapIterator } from "./map-iterator.js";
import { ParallelIterator } from "./parallel-iterator.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import type { CompletionIterator, CompletionResult } from "./iterator-completion.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });

it.each(["map", "filter", "enumerate", "zip"] as const)("%s forwards source completion without copying or latching it", kind => {
  const meter = budget(), error = { kind: "GuestStop" }, done = { done: true as const, value: undefined, exception: { value: error } }; let pulls = 0;
  const source: CompletionIterator<number> = { next: () => ++pulls === 1 ? done : { done: false, value: 7 } };
  const iterator = kind === "map" ? new MapIterator(0, [source], false, { call: (_fn, args) => args[0], isStopIteration: () => false }, meter)
    : kind === "filter" ? new FilterIterator(0, source, { isTruthPredicate: () => true, call: () => 0, truth: () => true, isStopIteration: () => false }, meter)
    : kind === "enumerate" ? new EnumerateIterator(source, 9n, (index, value) => [index, value], meter)
    : new ParallelIterator([source], false, row => row, meter);
  expect(iterator.next()).toBe(done);
  expect(iterator.next()).toEqual({ done: false, value: kind === "enumerate" ? [9n, 7] : kind === "zip" ? [7] : 7 });
});
it.each([false, true])("map retains callback exhaustion with strict=%s", strict => {
  const error = { kind: "CallbackStop" }; let calls = 0;
  const iterator = new MapIterator(0, [ [1, 2][Symbol.iterator]() ], strict, {
    call: (_fn, args) => { if (++calls === 1) throw error; return args[0]; }, isStopIteration: value => value === error
  }, budget());
  expect(iterator.next()).toEqual({ done: true, value: undefined, exception: { value: error } });
  expect(iterator.next()).toEqual({ done: false, value: 2 });
});
it.each(["predicate", "truth"])("filter retains %s exhaustion without latching", phase => {
  const error = new Error("stop"); let calls = 0;
  const iterator = new FilterIterator(0, [1, 2][Symbol.iterator](), {
    isTruthPredicate: () => phase === "truth",
    call: (_fn, value) => { if (++calls === 1) throw error; return value; },
    truth: () => { if (phase === "truth" && ++calls === 1) throw error; return true; },
    isStopIteration: value => value === error
  }, budget());
  expect(iterator.next()).toEqual({ done: true, value: undefined, exception: { value: error } });
  expect(iterator.next()).toEqual({ done: false, value: 2 });
});
it.each(["zip", "map"] as const)("strict %s discards source completion payloads but retains mismatch errors", kind => {
  const meter = budget(), done: CompletionResult<number> = { done: true, value: undefined, exception: { value: new Error("stop") } };
  const stop = { next: () => done };
  const construct = (sources: CompletionIterator<number>[]) => kind === "zip"
    ? new ParallelIterator(sources, true, row => row, meter)
    : new MapIterator(0, sources, true, { call: (_fn, row) => row[0], isStopIteration: () => false }, meter);
  expect(construct([stop, stop]).next()).toEqual({ done: true, value: undefined });
  expect(() => construct([stop, [1][Symbol.iterator]()]).next()).toThrow(`${kind}() argument 2 is longer than argument 1`);
  expect(() => construct([[1][Symbol.iterator](), stop]).next()).toThrow(`${kind}() argument 2 is shorter than argument 1`);
});
it.each(["map", "filter"])("%s checks cancellation after exception classification", kind => {
  let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const call = () => { throw new Error("stop"); }, isStopIteration = () => { cancelled = true; return true; };
  const iterator = kind === "map" ? new MapIterator(0, [[1][Symbol.iterator]()], false, { call, isStopIteration }, meter)
    : new FilterIterator(0, [1][Symbol.iterator](), { call, isStopIteration, isTruthPredicate: () => false, truth: () => true }, meter);
  expect(() => iterator.next()).toThrow(ExecutionLimitError);
});
