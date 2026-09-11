import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { LexicalFrame } from "./lexical-frame.js";
import { createFunctionFrame, type FunctionFrameContext } from "./function-frame.js";
import { executeStatements } from "./statement-execution.js";

const budget = () => new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 });
const scope = (source: string) => analyzeModule(source).scopes.children[0];
function fixture() {
  const events: string[] = [];
  const context: FunctionFrameContext<unknown> = {
    globals: new Map(), builtins: new Map(),
    tuple: values => { events.push("tuple"); return [...values]; },
    dictionary: values => { events.push("dictionary"); return new Map(values); }
  };
  return { context, events };
}

describe("function argument frame initialization", () => {
  it("installs positional, keyword-only, default and variadic bindings", () => {
    const state = fixture();
    const frame = createFunctionFrame(scope("def f(a, /, b, *args, c, d=0, **kw): pass"), {
      name: "f", positional: [1, 2, 3, 4], keywords: new Map([["c", 5], ["a", 6], ["extra", 7]]), defaults: new Map([["d", 8]])
    }, state.context, budget());
    expect([frame.load("a"), frame.load("b"), frame.load("c"), frame.load("d")]).toEqual([1, 2, 5, 8]);
    expect(frame.load("args")).toEqual([3, 4]);
    expect(frame.load("kw")).toEqual(new Map([["a", 6], ["extra", 7]]));
    expect(state.events).toEqual(["tuple", "dictionary"]);
  });

  it("creates empty variadic bindings and a fresh kwargs dictionary per call", () => {
    const state = fixture(), resolved = scope("def f(*args, **kw): pass");
    const call = { name: "f", positional: [], keywords: new Map(), defaults: new Map() };
    const first = createFunctionFrame(resolved, call, state.context, budget());
    const second = createFunctionFrame(resolved, call, state.context, budget());
    expect(first.load("args")).toEqual([]);
    expect(first.load("kw")).toEqual(new Map());
    expect(first.load("kw")).not.toBe(second.load("kw"));
  });

  it("retains default identity while allocating independent local storage", () => {
    const state = fixture(), resolved = scope("def f(a=ignored, *, b=ignored): pass");
    const shared: unknown[] = [];
    const call = { name: "f", positional: [], keywords: new Map(), defaults: new Map<string, unknown>([["a", shared], ["b", undefined]]) };
    const first = createFunctionFrame(resolved, call, state.context, budget());
    const second = createFunctionFrame(resolved, call, state.context, budget());
    expect(first.load("a")).toBe(shared);
    expect(second.load("a")).toBe(shared);
    expect(first.load("b")).toBeUndefined();
    first.store("a", 9);
    expect(second.load("a")).toBe(shared);
    expect(state.events).toEqual([]);
  });

  it("initializes captured parameters in owned cells and retains enclosing cells", () => {
    const state = fixture(), outerScope = scope("def outer(x):\n def f(a):\n  def child(): return a + x\n  return x");
    const outer = new LexicalFrame(outerScope, state.context, budget());
    outer.store("x", 10);
    const resolved = outerScope.children[0];
    const frame = createFunctionFrame(resolved, { name: "outer.<locals>.f", positional: [20], keywords: new Map(), defaults: new Map() },
      { ...state.context, closure: outer.capture(resolved) }, budget());
    const child = new LexicalFrame(resolved.children[0], { ...state.context, closure: frame.capture(resolved.children[0]) }, budget());
    expect(child.load("a")).toBe(20);
    outer.store("x", 30);
    expect(child.load("x")).toBe(30);
  });

  it("mangles private parameter and default names but never supplied keyword keys", () => {
    const resolved = analyzeModule("class C:\n def f(__x=ignored, *, __y=ignored, **kw): pass").scopes.children[0].children[0];
    const state = fixture();
    const frame = createFunctionFrame(resolved, { name: "C.f", positional: [], keywords: new Map([["_C__x", 2], ["__y", 3]]), defaults: new Map([["__x", 0], ["__y", 1]]) }, state.context, budget());
    expect(frame.load("__x")).toBe(2);
    expect(frame.load("__y")).toBe(1);
    expect(frame.load("kw")).toEqual(new Map([["__y", 3]]));
  });

  it("does not normalize expanded Unicode keyword keys", () => {
    const state = fixture();
    const frame = createFunctionFrame(scope("def f(K=ignored, **kw): pass"), { name: "f", positional: [], keywords: new Map([["K", 2]]), defaults: new Map([["K", 1]]) }, state.context, budget());
    expect(frame.load("K")).toBe(1);
    expect(frame.load("kw")).toEqual(new Map([["K", 2]]));
  });

  it.each([
    { source: "def f(a, *args): pass", positional: [], keywords: [], error: "f() missing 1 required positional argument: 'a'" },
    { source: "def f(a, **kw): pass", positional: [1], keywords: [["a", 2]], error: "f() got multiple values for argument 'a'" },
    { source: "def f(a): pass", positional: [1, 2], keywords: [], error: "f() takes 1 positional argument but 2 were given" }
  ])("preserves binding diagnostics and avoids container construction on failure: $error", test => {
    const state = fixture();
    expect(() => createFunctionFrame(scope(test.source), { name: "f", positional: test.positional, keywords: new Map(test.keywords as [string, number][]), defaults: new Map() }, state.context, budget())).toThrow(test.error);
    expect(state.events).toEqual([]);
  });

  it("uses the supplied function diagnostic name", () => {
    expect(() => createFunctionFrame(scope("def f(a): pass"), { name: "C.f", positional: [], keywords: new Map(), defaults: new Map() }, fixture().context, budget())).toThrow("C.f() missing 1 required positional argument: 'a'");
  });

  it.each(["def f(a): return a", "async def f(a): return a", "def f(a): yield a", "f = lambda a: a"])("prepares but does not execute a body: %s", source => {
    const resolved = scope(source);
    const frame = createFunctionFrame(resolved, { name: "f", positional: [7], keywords: new Map(), defaults: new Map() }, fixture().context, budget());
    expect(frame.load("a")).toBe(7);
  });

  it("supplies argument locals to statement execution", () => {
    const resolved = scope("def f(a): return a");
    const meter = budget();
    const frame = createFunctionFrame(resolved, { name: "f", positional: [undefined], keywords: new Map(), defaults: new Map() }, fixture().context, meter);
    if (resolved.scope.node.kind !== "function") throw new Error("expected function");
    const result = executeStatements(resolved.scope.node.body, {
      evaluate: expression => { if (expression.kind !== "name") throw new Error("unexpected expression"); return frame.load(expression.name); },
      test: () => { throw new Error("unexpected branch"); },
      iterate: () => { throw new Error("unexpected iteration"); },
      assign: () => { throw new Error("unexpected assignment"); },
      execute: () => { throw new Error("unexpected leaf"); }
    }, meter);
    expect(result).toEqual({ kind: "return", value: undefined });
  });

  it("rejects non-function scopes before doing argument work", () => {
    const state = fixture();
    expect(() => createFunctionFrame(analyzeModule("pass").scopes, { name: "f", positional: [], keywords: new Map(), defaults: new Map() }, state.context, budget())).toThrow("function calls require a function, lambda or generator-expression scope");
    expect(state.events).toEqual([]);
  });

  it("observes execution limits before constructing variadics", () => {
    const state = fixture();
    expect(() => createFunctionFrame(scope("def f(*args): pass"), { name: "f", positional: [1], keywords: new Map(), defaults: new Map() }, state.context,
      new ExecutionBudget({ maxSteps: 0, maxAllocatedBytes: 10000 }))).toThrow(ExecutionLimitError);
    expect(state.events).toEqual([]);
  });
});
