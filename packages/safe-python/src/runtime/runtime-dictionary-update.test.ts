import { describe, expect, it } from "vitest";
import { updateRuntimeDictionary, constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const hash = { none: v.none, identity: () => 17n, string: () => 23n, bytes: () => 29n };
  let hashes = 0;
  const keys = { hash: (key: RuntimeValue) => { hashes++; return runtimeHash(key, hash, meter); }, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  return { v, meter, keys, hashes: () => hashes, dictionary: () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter)) };
}

describe("runtime dictionary update and construction", () => {
  it("preserves next errors and does not close or advance the outer iterator", () => {
    const { v, meter, dictionary } = fixture(), d = dictionary(), events: string[] = [], failure = new PythonRuntimeError("TypeError", "row failed");
    function* row() { yield v.true; yield v.false; throw failure; }
    function* outer() { try { yield v.iterator(row()); events.push("later"); } finally { events.push("closed"); } }
    expect(() => updateRuntimeDictionary(d, v.iterator(outer()), v, meter)).toThrow(failure);
    expect(d.items.size).toBe(0); expect(events).toEqual([]);
  });
  it("bounds infinite rows without inserting an incomplete pair", () => {
    const { v, dictionary } = fixture(), d = dictionary();
    function* row() { while (true) yield v.true; }
    const source = v.tuple([v.iterator(row())]);
    expect(() => updateRuntimeDictionary(d, source, v, new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 100000 }))).toThrow(ExecutionLimitError);
    expect(d.items.size).toBe(0);
  });
  it("updates exact dictionaries without rehashing and shares their values", () => {
    const { v, meter, dictionary, hashes } = fixture(), a = dictionary(), b = dictionary(), value = v.list([]);
    a.items.set(v.true, value); const before = hashes();
    expect(updateRuntimeDictionary(b, a, v, meter)).toBe(v.none); expect(hashes()).toBe(before);
    expect(b.items.lookup(v.integer(1))?.value).toBe(value);
    expect(updateRuntimeDictionary(a, a, v, meter)).toBe(v.none);
  });
  it("consumes tuple, list and string pairs and retains original key order", () => {
    const { v, meter, dictionary } = fixture(), d = dictionary();
    updateRuntimeDictionary(d, v.list([v.tuple([v.integer(1), v.true]), v.list([v.float(1), v.false]), v.string("ab")]), v, meter);
    expect(d.items.snapshot()).toEqual([[v.integer(1), v.false], [v.string("a"), v.string("b")]]);
  });
  it("keeps earlier writes after a malformed row without advancing later rows", () => {
    const { v, meter, dictionary } = fixture(), d = dictionary(), events: string[] = [];
    function* rows() { yield v.tuple([v.true, v.none]); yield v.tuple([v.false]); events.push("later"); yield v.none; }
    expect(() => updateRuntimeDictionary(d, v.iterator(rows()), v, meter)).toThrow("dictionary update sequence element #1 has length 1; 2 is required");
    expect(d.items.size).toBe(1); expect(events).toEqual([]);
  });
  it("fully consumes iterator rows before validating their length", () => {
    const { v, meter, dictionary } = fixture(), d = dictionary(), events: number[] = [];
    function* row() { for (let i = 0; i < 4; i++) { events.push(i); yield v.integer(i); } }
    expect(() => updateRuntimeDictionary(d, v.tuple([v.iterator(row())]), v, meter)).toThrow("has length 4; 2 is required");
    expect(events).toEqual([0, 1, 2, 3]); expect(d.items.size).toBe(0);
  });
  it("distinguishes invalid outer sources, invalid rows and unhashable keys", () => {
    const { v, meter, dictionary } = fixture(), d = dictionary();
    expect(() => updateRuntimeDictionary(d, v.none, v, meter)).toThrow("'NoneType' object is not iterable");
    expect(() => updateRuntimeDictionary(d, v.list([v.integer(1)]), v, meter)).toThrow("object is not iterable");
    expect(() => updateRuntimeDictionary(d, v.list([v.tuple([v.list([]), v.none])]), v, meter)).toThrow("cannot use 'list' as a dict key (unhashable type: 'list')");
  });
  it("constructs fresh dictionaries and applies keywords after positional data", () => {
    const { v, meter, keys } = fixture(), keywords = new Map([["a", v.true], ["b", v.false]]);
    const source = v.list([v.tuple([v.string("a"), v.none])]);
    const a = constructRuntimeDictionary([source], keywords, v, keys, meter), b = constructRuntimeDictionary([], new Map(), v, keys, meter);
    expect(a.items.snapshot()).toEqual([[v.string("a"), v.true], [v.string("b"), v.false]]); expect(a).not.toBe(b); expect(b.items.size).toBe(0);
  });
  it("validates constructor arity before consuming positional sources", () => {
    const { v, meter, keys } = fixture(); let consumed = false;
    function* rows() { consumed = true; yield v.none; }
    expect(() => constructRuntimeDictionary([v.iterator(rows()), v.none], new Map(), v, keys, meter)).toThrow("dict expected at most 1 argument, got 2");
    expect(consumed).toBe(false);
  });
});
