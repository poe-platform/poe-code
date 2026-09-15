import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { LexicalFrame } from "./lexical-frame.js";

const budget = (maxSteps = 1000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
const scope = (source: string) => analyzeModule(source).scopes.children[0];

describe("lexical frame storage", () => {
  it("never falls back to globals for an unbound local", () => {
    const frame = new LexicalFrame(scope("def f():\n x = x"), { globals: new Map([["x", 10]]), builtins: new Map() }, budget());
    expect(() => frame.load("x")).toThrow(expect.objectContaining({ name: "UnboundLocalError", message: "cannot access local variable 'x' where it is not associated with a value" }));
    frame.store("x", 20);
    expect(frame.load("x")).toBe(20);
    frame.delete("x");
    expect(() => frame.delete("x")).toThrow(expect.objectContaining({ name: "UnboundLocalError" }));
  });

  it("distinguishes null and undefined values from missing bindings", () => {
    const frame = new LexicalFrame<unknown>(scope("def f(x): return x"), { globals: new Map(), builtins: new Map() }, budget());
    for (const value of [null, undefined]) {
      frame.store("x", value);
      expect(frame.load("x")).toBe(value);
      frame.delete("x");
      expect(() => frame.load("x")).toThrow(expect.objectContaining({ name: "UnboundLocalError" }));
    }
  });

  it("reads live globals then builtins, but writes and deletes only globals", () => {
    const globals = new Map<string, unknown>(), builtins = new Map<string, unknown>([["x", undefined]]);
    const frame = new LexicalFrame(scope("def f():\n global x\n x = x\n del x"), { globals, builtins }, budget());
    expect(frame.load("x")).toBeUndefined();
    expect(() => frame.delete("x")).toThrow(expect.objectContaining({ name: "NameError", message: "name 'x' is not defined" }));
    frame.store("x", null);
    expect(globals.get("x")).toBeNull();
    expect(frame.load("x")).toBeNull();
    globals.set("x", 3);
    expect(frame.load("x")).toBe(3);
    frame.delete("x");
    builtins.set("x", 4);
    expect(frame.load("x")).toBe(4);
    builtins.clear();
    expect(() => frame.load("x")).toThrow(expect.objectContaining({ name: "NameError" }));
  });

  it("shares cells between siblings, including deletion and later rebinding", () => {
    const outerScope = scope("def outer():\n x=1\n def a():\n  nonlocal x\n  x=2\n  del x\n def b(): return x");
    const namespaces = { globals: new Map(), builtins: new Map() };
    const outer = new LexicalFrame<unknown>(outerScope, namespaces, budget());
    const a = new LexicalFrame(outerScope.children[0], { ...namespaces, closure: outer.capture(outerScope.children[0]) }, budget());
    const b = new LexicalFrame(outerScope.children[1], { ...namespaces, closure: outer.capture(outerScope.children[1]) }, budget());
    expect(() => outer.load("x")).toThrow(expect.objectContaining({ name: "UnboundLocalError" }));
    expect(() => b.load("x")).toThrow(expect.objectContaining({ name: "NameError", message: "cannot access free variable 'x' where it is not associated with a value in enclosing scope" }));
    expect(() => a.delete("x")).toThrow(expect.objectContaining({ name: "NameError" }));
    outer.store("x", undefined);
    expect(b.load("x")).toBeUndefined();
    a.store("x", 2);
    expect(outer.load("x")).toBe(2);
    expect(b.load("x")).toBe(2);
    a.delete("x");
    expect(() => b.load("x")).toThrow(expect.objectContaining({ name: "NameError" }));
    outer.store("x", 3);
    expect(b.load("x")).toBe(3);
  });

  it("forwards cells through a scope that never reads the name", () => {
    const outerScope = scope("def outer():\n x=1\n def middle():\n  def inner(): return x");
    const namespaces = { globals: new Map(), builtins: new Map() };
    const outer = new LexicalFrame(outerScope, namespaces, budget());
    const middleScope = outerScope.children[0], innerScope = middleScope.children[0];
    const middle = new LexicalFrame(middleScope, { ...namespaces, closure: outer.capture(middleScope) }, budget());
    const inner = new LexicalFrame(innerScope, { ...namespaces, closure: middle.capture(innerScope) }, budget());
    outer.store("x", 9);
    expect(inner.load("x")).toBe(9);
  });

  it("isolates locals and cells between separate invocations", () => {
    const resolved = scope("def f(x):\n y=1\n def g(): return x");
    const namespaces = { globals: new Map(), builtins: new Map() };
    const a = new LexicalFrame(resolved, namespaces, budget()), b = new LexicalFrame(resolved, namespaces, budget());
    a.store("x", 1); a.store("y", 2);
    expect(() => b.load("x")).toThrow(expect.objectContaining({ name: "UnboundLocalError" }));
    expect(() => b.load("y")).toThrow(expect.objectContaining({ name: "UnboundLocalError" }));
    expect(a.capture(resolved.children[0]).get("x")).not.toBe(b.capture(resolved.children[0]).get("x"));
  });

  it("mangles private names using the lexical class context", () => {
    const resolved = analyzeModule("class C:\n def f(__x):\n  return __x + __global").scopes.children[0].children[0];
    const frame = new LexicalFrame(resolved, { globals: new Map([["_C__global", 7]]), builtins: new Map() }, budget());
    frame.store("__x", 4);
    expect(frame.load("__x")).toBe(4);
    expect(frame.load("_C__x")).toBe(4);
    expect(frame.load("__global")).toBe(7);
  });

  it("connects comprehension walrus targets and lambda captures", () => {
    const resolved = scope("def f():\n result=[(saved:=x, lambda: x) for x in source]\n return saved");
    const namespaces = { globals: new Map(), builtins: new Map() };
    const fn = new LexicalFrame(resolved, namespaces, budget());
    const compScope = resolved.children[0], lambdaScope = compScope.children[0];
    const comp = new LexicalFrame(compScope, { ...namespaces, closure: fn.capture(compScope) }, budget());
    const lambda = new LexicalFrame(lambdaScope, { ...namespaces, closure: comp.capture(lambdaScope) }, budget());
    comp.store("saved", 5); comp.store("x", 6);
    expect(fn.load("saved")).toBe(5);
    expect(lambda.load("x")).toBe(6);
  });

  it("rejects missing or wrong-owner closure cells as host integration errors", () => {
    const resolved = scope("def f():\n x=1\n def g(): return x");
    const other = scope("def f():\n x=1\n def g(): return x");
    const namespaces = { globals: new Map(), builtins: new Map() };
    expect(() => new LexicalFrame(resolved.children[0], namespaces, budget())).toThrow("missing or invalid closure cell: x");
    const wrong = new LexicalFrame(other, namespaces, budget()).capture(other.children[0]);
    expect(() => new LexicalFrame(resolved.children[0], { ...namespaces, closure: wrong }, budget())).toThrow("missing or invalid closure cell: x");
  });

  it.each(["module", "class"])("rejects %s namespaces rather than applying function lookup rules", kind => {
    const root = analyzeModule("class C: pass").scopes;
    expect(() => new LexicalFrame(kind === "module" ? root : root.children[0], { globals: new Map(), builtins: new Map() }, budget())).toThrow("lexical frames require a function, lambda or comprehension scope");
  });

  it("does not silently create globals for unresolved compiler names", () => {
    const globals = new Map();
    const frame = new LexicalFrame(scope("def f(): pass"), { globals, builtins: new Map() }, budget());
    expect(() => frame.store("unknown", 1)).toThrow("name was not resolved: unknown");
    expect(globals.size).toBe(0);
  });

  it("checks limits before changing storage", () => {
    const frame = new LexicalFrame(scope("def f(x): return x"), { globals: new Map(), builtins: new Map() }, budget(2));
    frame.store("x", 1);
    expect(() => frame.store("x", 2)).toThrow(ExecutionLimitError);
    expect(() => frame.load("x")).toThrow(ExecutionLimitError);
  });
});
