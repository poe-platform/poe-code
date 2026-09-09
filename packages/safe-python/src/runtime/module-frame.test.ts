import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ModuleFrame, type ModuleNamespaces } from "./module-frame.js";

function fixture(source = "x") {
  const globals = new Map<string, unknown>(), builtins = new Map<string, unknown>(), locals = new Map<string, unknown>();
  const events: string[] = [];
  const namespaces: ModuleNamespaces<unknown> = {
    globals, builtins,
    locals: {
      lookup: name => { events.push(`get:${name}`); return locals.has(name) ? { value: locals.get(name) } : undefined; },
      store: (name, value) => { events.push(`set:${name}`); locals.set(name, value); },
      delete: name => { events.push(`delete:${name}`); return locals.delete(name); },
      isGuest: error => error instanceof PythonRuntimeError
    }
  };
  const frame = new ModuleFrame(analyzeModule(source).scopes, namespaces, new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }));
  return { frame, globals, builtins, locals, events, namespaces };
}

describe("module frame namespaces", () => {
  it("searches live locals, globals and builtins in order", () => {
    const state = fixture();
    state.locals.set("x", undefined); state.globals.set("x", null); state.builtins.set("x", 3);
    expect(state.frame.load("x")).toBeUndefined();
    state.locals.delete("x");
    expect(state.frame.load("x")).toBeNull();
    state.globals.delete("x");
    expect(state.frame.load("x")).toBe(3);
    state.builtins.delete("x");
    expect(() => state.frame.load("x")).toThrow(expect.objectContaining({ name: "NameError", message: "name 'x' is not defined" }));
    expect(state.events).toEqual(["get:x", "get:x", "get:x", "get:x"]);
  });

  it("stores and deletes through local mapping protocols without deleting globals", () => {
    const state = fixture("x=1\ndel x");
    state.globals.set("x", 8);
    state.frame.store("x", 2);
    expect(state.locals.get("x")).toBe(2);
    state.frame.delete("x");
    expect(() => state.frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
    expect(state.globals.get("x")).toBe(8);
    expect(state.events).toEqual(["set:x", "delete:x", "delete:x"]);
  });

  it.each([
    "global x\nx=1",
    "x=1\ndef f(): global x",
    "x=1\nclass C:\n global x",
    "x=1\ndef f():\n def g(): global x",
    "x=1\nif False:\n def f(): global x"
  ])("bypasses locals for explicit globals anywhere in the module's scope tree: %s", source => {
    const state = fixture(source);
    state.locals.set("x", 10); state.builtins.set("x", 20);
    expect(state.frame.load("x")).toBe(20);
    state.frame.store("x", 30);
    expect(state.frame.load("x")).toBe(30);
    state.frame.delete("x");
    expect(() => state.frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
    expect(state.locals.get("x")).toBe(10);
    expect(state.events).toEqual([]);
  });

  it("uses class-mangled descendant globals without mangling module names", () => {
    const state = fixture("class C:\n def f(): global __x");
    state.frame.store("_C__x", 1); state.frame.store("__x", 2);
    expect(state.globals.get("_C__x")).toBe(1);
    expect(state.locals.get("__x")).toBe(2);
  });

  it("uses globals directly when no distinct local mapping is supplied", () => {
    const globals = new Map<string, unknown>(), builtins = new Map<string, unknown>([["x", 1]]);
    const frame = new ModuleFrame(analyzeModule("pass").scopes, { globals, builtins }, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }));
    expect(frame.load("x")).toBe(1);
    frame.store("x", undefined);
    expect(frame.load("x")).toBeUndefined();
    frame.delete("x");
    expect(frame.load("x")).toBe(1);
    expect(() => frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
  });

  it("propagates lookup and store errors instead of falling back", () => {
    const state = fixture(), error = new PythonRuntimeError("ValueError", "mapping failure");
    state.globals.set("x", 2);
    state.namespaces.locals!.lookup = () => { throw error; };
    state.namespaces.locals!.store = () => { throw error; };
    expect(() => state.frame.load("x")).toThrow(error);
    expect(() => state.frame.store("x", 3)).toThrow(error);
    expect(state.globals.get("x")).toBe(2);
  });

  it("replaces guest mapping deletion failures with NameError", () => {
    const state = fixture();
    state.namespaces.locals!.delete = () => { throw new PythonRuntimeError("ValueError", "mapping failure"); };
    expect(() => state.frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError", message: "name 'x' is not defined" }));
  });

  it.each([new Error("host failure"), new ExecutionLimitError("steps")])("never masks fatal mapping deletion errors: %s", error => {
    const state = fixture();
    state.namespaces.locals!.delete = () => { throw error; };
    if (error instanceof ExecutionLimitError) state.namespaces.locals!.isGuest = () => true;
    expect(() => state.frame.delete("x")).toThrow(error);
  });

  it("does not confuse module annotations with unbound optimized locals", () => {
    const state = fixture("x: ignored");
    state.builtins.set("x", 2);
    expect(state.frame.load("x")).toBe(2);
  });

  it("rejects non-module scopes", () => {
    const scope = analyzeModule("def f(): pass").scopes.children[0];
    expect(() => new ModuleFrame(scope, { globals: new Map(), builtins: new Map() }, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 10000 }))).toThrow("module frames require a module scope");
  });

  it("meters descendant-scope scanning and stops before mapping operations", () => {
    const state = fixture();
    expect(() => new ModuleFrame(analyzeModule("def f():\n def g(): global x").scopes, state.namespaces,
      new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
});
