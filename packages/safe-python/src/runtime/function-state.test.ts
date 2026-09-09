import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";
import { createFunctionState, type FunctionState } from "./function-state.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import type { LexicalCell } from "./lexical-frame.js";
import { createFunctionFrame } from "./function-frame.js";
import { executeFunctionDefinition } from "./function-definition.js";
import { lookupNamespace } from "./namespace-lookup.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
function fixture(source = 'def f(a):\n "doc"\n return a') {
  const program = compileProgram<unknown>(analyzeModule(source), { stripDocstring: false }, { string: value => value, integer: value => value, tuple: values => [...values] }, budget());
  const code = [...program.functions.values()].at(-1)!;
  const globals = new Map<string, unknown>([["__name__", "module"]]), builtins = new Map<string, unknown>();
  const closure = new Map<string, LexicalCell<unknown>>([...code.scope.free].map(([name, owner]) => [name, { owner }]));
  const defaults = new Map<string, unknown>(), none = {};
  const context = { globals, builtins, closure, none };
  const run = () => createFunctionState(code, defaults, context, budget());
  return { code, globals, builtins, closure, defaults, none, context, run };
}

describe("function definition state", () => {
  it("receives definition-time defaults and binds the resulting function state", () => {
    const state = fixture("def f(a=seed): return a"), seed = {};
    const node = state.code.scope.scope.node;
    if (node.kind !== "function") throw new Error("expected function");
    state.globals.set("seed", seed);
    executeFunctionDefinition(node, {
      evaluate: expression => { if (expression.kind !== "name") throw new Error("unexpected expression"); return state.globals.get(expression.name); },
      create: (statement, defaults) => { expect(statement).toBe(node); return createFunctionState(state.code, defaults, state.context, budget()); },
      decorate: () => { throw new Error("unexpected decorator"); },
      store: (name, value) => { state.globals.set(name, value); }
    }, budget());
    const value = state.globals.get("f") as FunctionState<unknown>;
    expect(value.code).toBe(state.code);
    expect(value.defaults.get("a")).toBe(seed);
    expect(value.globals.get("f")).toBe(value);
  });

  it("initializes compiled metadata and retains live defining dictionaries", () => {
    const state = fixture(), value = state.run();
    expect(value.code).toBe(state.code);
    expect(value.name).toBe("f"); expect(value.qualifiedName).toBe("f");
    expect(value.doc).toBe("doc"); expect(value.module).toBe("module");
    expect(value.globals).toBe(state.globals); expect(value.builtins).toBe(state.builtins);
    expect(value.attributes.size).toBe(0);
  });
  it("copies the defaults container without copying its values", () => {
    const state = fixture(), defaultValue = {};
    state.defaults.set("a", defaultValue); const value = state.run();
    state.defaults.clear();
    expect(value.defaults.get("a")).toBe(defaultValue);
    expect(value.defaults).not.toBe(state.defaults);
  });
  it("captures module metadata once while retaining global dictionary mutations", () => {
    const state = fixture(), module = {};
    state.globals.set("__name__", module); const value = state.run();
    state.globals.set("__name__", "later"); state.globals.set("dynamic", 1);
    expect(value.module).toBe(module); expect(value.globals.get("dynamic")).toBe(1);
  });
  it("uses None only for absent module/doc metadata, not guest undefined", () => {
    const state = fixture("f=lambda: 1"); state.globals.delete("__name__");
    const value = state.run(); expect(value.module).toBe(state.none); expect(value.doc).toBe(state.none);
    state.globals.set("__name__", undefined);
    expect(state.run().module).toBeUndefined();
    const code = { ...state.code, docstring: { value: undefined } };
    expect(createFunctionState(code, state.defaults, state.context, budget()).doc).toBeUndefined();
  });
  it("captures only required cells and preserves empty cell identities", () => {
    const state = fixture("def outer():\n x=1\n def inner(): return x");
    const cell = state.closure.get("x")!;
    state.closure.set("unneeded", { owner: cell.owner });
    const value = state.run(); state.closure.clear();
    expect([...value.closure.keys()]).toEqual(["x"]);
    expect(value.closure.get("x")).toBe(cell); expect(cell.content).toBeUndefined();
    cell.content = { value: 42 }; expect(value.closure.get("x")!.content!.value).toBe(42);
  });
  it.each(["missing", "wrong-owner"])("rejects %s closure cells at creation", mode => {
    const state = fixture("def outer():\n x=1\n def inner(): return x");
    if (mode === "missing") state.closure.clear();
    else state.closure.set("x", { owner: state.code.scope.scope });
    expect(() => state.run()).toThrow("missing or invalid closure cell: x");
  });
  it("isolates function attribute dictionaries and defaults across definitions", () => {
    const state = fixture(), first = state.run(), second = state.run();
    first.attributes.set("custom", 1);
    expect(second.attributes.has("custom")).toBe(false);
    expect(first.defaults).not.toBe(second.defaults);
    expect(first.code).toBe(second.code);
  });
  it("supplies captured state to fresh call frames", () => {
    const state = fixture("def outer():\n x=1\n def inner(a): return x");
    const object = {}; state.defaults.set("a", object);
    const value = state.run(); state.closure.get("x")!.content = { value: 42 };
    const frame = createFunctionFrame(value.code.scope, { name: "inner", positional: [], keywords: new Map(), defaults: value.defaults }, {
      ...value, tuple: values => [...values], dictionary: values => new Map(values)
    }, budget());
    expect(frame.load("a")).toBe(object); expect(frame.load("x")).toBe(42);
    state.builtins.set("dynamic", 99); expect(lookupNamespace(value.builtins, "dynamic")).toEqual({ value: 99 });
  });
  it("checks the entry budget before capturing state", () => {
    const state = fixture();
    expect(() => createFunctionState(state.code, state.defaults, state.context, new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 1000 }))).toThrow(ExecutionLimitError);
  });
});
