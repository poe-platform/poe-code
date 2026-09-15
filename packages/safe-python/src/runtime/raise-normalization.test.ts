import { describe, expect, it } from "vitest";
import { normalizeRaisedException, type RaiseNormalizationContext } from "./raise-normalization.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

function fixture(maxSteps = 1000) {
  const requested = { name: "A" }, originalType = { name: "B" }, original = { type: originalType }, replacement = { type: requested }, invalidType = { name: "int" };
  const events: string[] = [], notes: [unknown, string][] = [];
  const context: RaiseNormalizationContext<unknown> = {
    typeOf: value => value === original ? originalType : value === replacement ? requested : invalidType,
    isSubclass: (type, parent) => { expect(type).toBe(originalType); expect(parent).toBe(requested); events.push("subclass"); return false; },
    call: (type, value) => { expect(type).toBe(requested); expect(value).toBe(original); events.push("call"); return replacement; },
    isInstance: value => value === original || value === replacement,
    repr: value => { const result = value === original ? "B()" : "<class 'A'>"; events.push(`repr:${result}`); return result; },
    typeName: type => (type as { name: string }).name,
    isGuest: error => error instanceof PythonRuntimeError,
    addNote: (error, note) => { events.push("note"); notes.push([error, note]); }
  };
  const meter = new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 });
  return { requested, original, replacement, events, notes, context, run: () => normalizeRaisedException(requested, original, context, meter) };
}

describe("final raise normalization", () => {
  it("preserves the existing value when a virtual subclass check accepts it", () => {
    const state = fixture(); state.context.isSubclass = () => { state.events.push("virtual"); return true; };
    expect(state.run()).toBe(state.original);
    expect(state.events).toEqual(["virtual"]);
  });

  it("reconstructs with the original instance as a single argument", () => {
    const state = fixture();
    expect(state.run()).toBe(state.replacement);
    expect(state.events).toEqual(["subclass", "call"]);
  });

  it("does not require the replacement instance to have the requested class", () => {
    const state = fixture(); state.context.call = () => state.original;
    expect(state.run()).toBe(state.original);
    expect(state.events).toEqual(["subclass"]);
  });

  it("propagates subclass-check failures without constructor notes", () => {
    const state = fixture(), error = new PythonRuntimeError("RuntimeError", "subclass failed");
    state.context.isSubclass = () => { throw error; };
    expect(() => state.run()).toThrow(error);
    expect(state.events).toEqual([]); expect(state.notes).toEqual([]);
  });

  it("preserves constructor-error identity while adding a normalization note", () => {
    const state = fixture(), error = new PythonRuntimeError("ValueError", "constructor failed");
    state.context.call = () => { throw error; };
    expect(() => state.run()).toThrow(error);
    expect(state.notes).toEqual([[error, "Normalization failed: type=A args=B()"]]);
  });

  it("validates reconstructed instances using the normalization diagnostic", () => {
    const state = fixture(); state.context.call = () => 3;
    expect(() => state.run()).toThrow("calling <class 'A'> should have returned an instance of BaseException, not int");
    expect(state.events).toEqual(["subclass", "repr:<class 'A'>", "repr:B()", "note"]);
    expect(state.notes[0][1]).toBe("Normalization failed: type=A args=B()");
  });

  it("uses an unknown-arguments note when the value's repr raises a guest error", () => {
    const state = fixture(), error = new PythonRuntimeError("ValueError", "constructor");
    state.context.call = () => { throw error; };
    state.context.repr = () => { throw new PythonRuntimeError("TypeError", "repr"); };
    expect(() => state.run()).toThrow(error);
    expect(state.notes).toEqual([[error, "Normalization failed: type=A args=<unknown>"]]);
  });

  it("keeps the original constructor error when note insertion raises a guest error", () => {
    const state = fixture(), error = new PythonRuntimeError("ValueError", "constructor");
    state.context.call = () => { throw error; };
    state.context.addNote = () => { throw new PythonRuntimeError("TypeError", "note"); };
    expect(() => state.run()).toThrow(error);
  });

  it.each(["constructor", "repr", "note"])("never suppresses a fatal execution limit during %s", stage => {
    const state = fixture(), fatal = new ExecutionLimitError("allocation");
    state.context.isGuest = () => true;
    state.context.call = () => { throw stage === "constructor" ? fatal : new PythonRuntimeError("ValueError", "constructor"); };
    if (stage === "repr") state.context.repr = () => { throw fatal; };
    if (stage === "note") state.context.addNote = () => { throw fatal; };
    expect(() => state.run()).toThrow(fatal);
  });

  it("does not turn unclassified host failures into guest normalization notes", () => {
    const state = fixture(), error = new Error("host bug"); state.context.call = () => { throw error; };
    expect(() => state.run()).toThrow(error);
    expect(state.notes).toEqual([]);
  });

  it("meters subclass lookup, construction and diagnostic work", () => {
    const empty = fixture(0); expect(() => empty.run()).toThrow("execution step limit exceeded"); expect(empty.events).toEqual([]);
    const state = fixture(1); expect(() => state.run()).toThrow("execution step limit exceeded"); expect(state.events).toEqual(["subclass"]);
  });
});
