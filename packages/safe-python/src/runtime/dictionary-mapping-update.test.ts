import { describe, expect, it } from "vitest";
import { updateDictionary, type DictionaryUpdateContext } from "./dictionary-mapping-update.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget } from "./execution-budget.js";

function fixture() {
  const events: string[] = [], result = new Map<unknown, unknown>();
  const context: DictionaryUpdateContext<unknown> = {
    hasKeys: () => { events.push("lookup"); return true; },
    callKeys: () => { events.push("lookup-call"); return ["a", "b"]; },
    typeName: value => typeof value === "number" ? "int" : "Mapping",
    sequence: value => Array.isArray(value) ? value : undefined,
    iterate: value => { if (typeof (value as Iterable<unknown>)[Symbol.iterator] !== "function") throw new PythonRuntimeError("TypeError", "custom"); return (value as Iterable<unknown>)[Symbol.iterator](); },
    prepare: iterator => { events.push("prepare"); return iterator; },
    isTypeError: error => error instanceof PythonRuntimeError && error.name === "TypeError",
    getItem: (_mapping, key) => { events.push(`get:${key}`); return key; },
    set: (key, value) => { events.push(`set:${key}`); result.set(key, value); }
  };
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
  return { context, meter, result, events };
}

describe("generic dictionary mapping updates", () => {
  it("performs optional lookup followed by a fresh keys call and ordered get/set", () => {
    const { context, meter, result, events } = fixture();
    updateDictionary({}, context, meter);
    expect(events).toEqual(["lookup", "lookup-call", "get:a", "set:a", "get:b", "set:b"]);
    expect([...result]).toEqual([["a", "a"], ["b", "b"]]);
  });
  it("fully materializes iterator keys before fetching values", () => {
    const { context, meter, events } = fixture();
    function* keys() { events.push("yield:a"); yield "a"; events.push("yield:b"); yield "b"; }
    context.callKeys = () => keys(); updateDictionary({}, context, meter);
    expect(events).toEqual(["lookup", "prepare", "yield:a", "yield:b", "get:a", "set:a", "get:b", "set:b"]);
  });
  it("retains live exact-list key iteration and fetches duplicate keys again", () => {
    const { context, meter, result } = fixture(), keys = ["a", "a"];
    let count = 0; context.callKeys = () => keys;
    context.getItem = () => { count++; if (count === 1) keys.push("b"); return count; };
    updateDictionary({}, context, meter); expect([...result]).toEqual([["a", 2], ["b", 3]]);
  });
  it("falls back to iterable pairs only when the optional keys lookup is absent", () => {
    const { context, meter, result, events } = fixture();
    context.hasKeys = () => false; context.callKeys = () => { throw new Error("unexpected keys"); };
    updateDictionary([["a", 1], ["b", 2]], context, meter);
    expect([...result]).toEqual([["a", 1], ["b", 2]]); expect(events).toEqual(["set:a", "set:b"]);
  });
  it("does not fall back after a second keys lookup or call failure", () => {
    const { context, meter } = fixture(), error = new PythonRuntimeError("AttributeError", "second lookup");
    context.callKeys = () => { throw error; }; context.iterate = () => { throw new Error("unexpected fallback"); };
    expect(() => updateDictionary({}, context, meter)).toThrow(error);
  });
  it("rewrites initial iteration TypeError for a noniterable keys result", () => {
    const { context, meter } = fixture(); context.callKeys = () => 1;
    expect(() => updateDictionary({}, context, meter)).toThrow("Mapping.keys() returned a non-iterable (type int)");
    const error = new PythonRuntimeError("TypeError", "prepare failed");
    context.callKeys = () => "ab"; context.prepare = () => { throw error; };
    expect(() => updateDictionary({}, context, meter)).toThrow(error);
  });
  it("preserves earlier inserts after getItem fails", () => {
    const { context, meter, result, events } = fixture(), error = new Error("get failed");
    context.getItem = (_source, key) => { if (key === "b") throw error; return 1; };
    expect(() => updateDictionary({}, context, meter)).toThrow(error);
    expect([...result]).toEqual([["a", 1]]); expect(events).toEqual(["lookup", "lookup-call", "set:a"]);
  });
  it("does not insert any entries when keys materialization fails", () => {
    const { context, meter, result } = fixture(), error = new Error("keys failed");
    function* keys() { yield "a"; throw error; }
    context.callKeys = () => keys(); expect(() => updateDictionary({}, context, meter)).toThrow(error);
    expect(result.size).toBe(0);
  });
});
