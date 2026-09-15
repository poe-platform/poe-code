import { describe, expect, it } from "vitest";
import { analyzeModule } from "./index.js";

describe("function execution classification", () => {
  it.each([
    ["def f(): return 1", ["function"]],
    ["def f(): yield 1", ["generator"]],
    ["def f(): yield from values", ["generator"]],
    ["def f():\n if False: yield 1", ["generator"]],
    ["async def f(): return 1", ["coroutine"]],
    ["async def f(): await task", ["coroutine"]],
    ["async def f(): yield 1", ["async-generator"]],
    ["async def f():\n if False: yield 1", ["async-generator"]],
    ["f = lambda: 1", ["function"]],
    ["f = lambda: (yield 1)", ["generator"]],
    ["f = lambda: (yield from values)", ["generator"]],
    ["def f():\n def g(): yield 1", ["generator", "function"]],
    ["def f():\n class C:\n  def g(): yield 1", ["generator", "function"]],
    ["def f():\n return lambda: (yield 1)", ["generator", "function"]],
    ["def f():\n def g(a=(yield 1)): pass", ["function", "generator"]],
    ["def f():\n @(yield 1)\n def g(): pass", ["function", "generator"]],
    ["def f():\n return lambda a=(yield 1): a", ["function", "generator"]],
    ["def f():\n return [x for x in (yield values)]", ["generator"]],
    ["def f():\n return (x for x in values)", ["function"]],
    ["async def f():\n return [await x for x in values]", ["coroutine"]],
    ["def f():\n try: pass\n finally: yield 1", ["generator"]],
    ["def f():\n try: pass\n except (yield 1): pass", ["generator"]]
  ])("records lexical execution kinds: %s", (source, expected) => {
    const analysis = analyzeModule(source as string);
    expect([...analysis.functionKinds.values()]).toEqual(expected);
    for (const node of analysis.functionKinds.keys()) expect(["function", "lambda"]).toContain(node.kind);
  });

  it("keys metadata by the same AST identities as resolved scopes", () => {
    const analysis = analyzeModule("def f():\n return lambda: (yield 1)");
    const fn = analysis.scopes.children[0], lambda = fn.children[0];
    if (fn.scope.node.kind !== "function" || lambda.scope.node.kind !== "lambda") throw new Error("unexpected scopes");
    expect(analysis.functionKinds.get(fn.scope.node)).toBe("function");
    expect(analysis.functionKinds.get(lambda.scope.node)).toBe("generator");
    expect([...analysis.functionKinds.keys()]).not.toContain(analysis.module);
  });

  it("does not retain classification state across analyses", () => {
    const first = analyzeModule("def f(): yield 1");
    const second = analyzeModule("def f(): pass");
    expect(first.functionKinds).not.toBe(second.functionKinds);
    expect([...second.functionKinds.values()]).toEqual(["function"]);
    expect([...second.functionKinds.keys()]).not.toContain(first.module.body[0]);
  });

  it("does not classify ignored type-only expressions", () => {
    const analysis = analyzeModule("def f(a: (lambda: (yield 1))) -> (lambda: (yield 1)):\n local: (lambda: (yield 1))\n return a");
    expect([...analysis.functionKinds.values()]).toEqual(["function"]);
  });

  it("retains async-generator return validation", () => {
    expect(() => analyzeModule("async def f():\n return 1\n yield 2")).toThrow("'return' with value in async generator");
  });
});
