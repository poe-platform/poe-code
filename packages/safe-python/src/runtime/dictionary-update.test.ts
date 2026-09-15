import { describe, expect, it } from "vitest";
import { updateDictionaryPairs, type PairUpdateContext } from "./dictionary-update.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  const result = new Map<unknown, unknown>();
  const context: PairUpdateContext<unknown> = {
    sequence: value => Array.isArray(value) ? value : undefined,
    iterate: value => { if (value === null || value === undefined || typeof (value as Iterable<unknown>)[Symbol.iterator] !== "function") throw new PythonRuntimeError("TypeError", "custom"); return (value as Iterable<unknown>)[Symbol.iterator](); },
    prepare: iterator => iterator,
    isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
    set: (key, value) => { result.set(key, value); }
  };
  return { meter, context, result };
}

describe("dictionary updates from iterable pairs", () => {
  it("updates in source order and retains successful earlier entries on failure", () => {
    const { meter, context, result } = fixture();
    expect(() => updateDictionaryPairs([["a", 1], ["a", 2], ["b", 3, 4]][Symbol.iterator](), context, meter)).toThrow("dictionary update sequence element #2 has length 3; 2 is required");
    expect([...result]).toEqual([["a", 2]]);
  });
  it.each([0, 1, 3, 10])("reports the exact malformed row length %i", length => {
    const { meter, context } = fixture();
    expect(() => updateDictionaryPairs([Array(length).fill(1)][Symbol.iterator](), context, meter)).toThrow(`dictionary update sequence element #0 has length ${length}; 2 is required`);
  });
  it("consumes non-sequence rows completely before validating their length", () => {
    const { meter, context, result } = fixture(), events: string[] = [];
    function* row() { for (let i = 0; i < 4; i++) { events.push(`next:${i}`); yield i; } }
    context.prepare = iterator => { events.push("prepare"); return iterator; };
    expect(() => updateDictionaryPairs([row()][Symbol.iterator](), context, meter)).toThrow("has length 4; 2 is required");
    expect(events).toEqual(["prepare", "next:0", "next:1", "next:2", "next:3"]); expect(result.size).toBe(0);
  });
  it("bypasses iteration and preparation for exact sequence fast paths", () => {
    const { meter, context, result } = fixture();
    context.iterate = () => { throw new Error("unexpected iterate"); };
    context.prepare = () => { throw new Error("unexpected prepare"); };
    updateDictionaryPairs([["a", undefined]][Symbol.iterator](), context, meter);
    expect(result.has("a")).toBe(true); expect(result.get("a")).toBeUndefined();
  });
  it("rewrites only TypeError from initial row iteration", () => {
    const { meter, context } = fixture();
    expect(() => updateDictionaryPairs([1][Symbol.iterator](), context, meter)).toThrow("object is not iterable");
    const error = new PythonRuntimeError("ValueError", "custom"); context.iterate = () => { throw error; };
    expect(() => updateDictionaryPairs([1][Symbol.iterator](), context, meter)).toThrow(error);
    context.iterate = () => [1, 2][Symbol.iterator]();
    const prepareError = new PythonRuntimeError("TypeError", "prepare failed"); context.prepare = () => { throw prepareError; };
    expect(() => updateDictionaryPairs([1][Symbol.iterator](), context, meter)).toThrow(prepareError);
  });
  it("preserves next failures instead of reporting a partial row length", () => {
    const { meter, context } = fixture(), error = new PythonRuntimeError("TypeError", "next failed");
    function* row() { yield 1; yield 2; yield 3; throw error; }
    expect(() => updateDictionaryPairs([row()][Symbol.iterator](), context, meter)).toThrow(error);
  });
  it("does not advance the outer iterator after a failed insertion or close it", () => {
    const { meter, context } = fixture(), events: string[] = [], error = new Error("set failed");
    function* source() { try { events.push("first"); yield [1, 2]; events.push("second"); yield [3, 4]; } finally { events.push("closed"); } }
    context.set = () => { throw error; };
    expect(() => updateDictionaryPairs(source(), context, meter)).toThrow(error); expect(events).toEqual(["first"]);
  });
  it("bounds infinite row iterators without inserting a partial row", () => {
    const { context, result } = fixture();
    function* row() { while (true) yield 1; }
    expect(() => updateDictionaryPairs([row()][Symbol.iterator](), context, new ExecutionBudget({ maxSteps: 20, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
    expect(result.size).toBe(0);
  });
});
