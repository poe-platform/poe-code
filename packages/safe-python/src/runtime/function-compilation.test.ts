import { describe, expect, it } from "vitest";
import { analyzeModule } from "../analysis.js";
import { compileFunction } from "./function-compilation.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

const budget = (maxSteps = 10000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 100000 });
const constants = { string: (text: string) => ({ text }), integer: (integer: number) => ({ integer }) };
function compile(source: string, stripDocstring = false) {
  const analysis = analyzeModule(source);
  return compileFunction<unknown>(analysis.scopes.children[0], analysis, { stripDocstring }, constants, budget());
}

describe("function code metadata compilation", () => {
  it("compiles normalized names, decorator line, cleaned docs and executable statements", () => {
    const code = compile('\n@decorate\ndef K():\n """  head\n\ttext\n """\n return 1');
    expect(code.name).toEqual({ text: "K" });
    expect(code.qualifiedName).toEqual({ text: "K" });
    expect(code.firstLine).toEqual({ integer: 2 });
    expect(code.docstring).toEqual({ value: { text: "head\ntext\n" } });
    expect(code.body.kind).toBe("suite");
    if (code.body.kind === "suite") expect(code.body.statements.map(statement => statement.kind)).toEqual(["return"]);
  });
  it.each([
    ["def f(): pass", "function"], ["def f(): yield 1", "generator"],
    ["async def f(): pass", "coroutine"], ["async def f(): yield 1", "async-generator"]
  ])("retains the analyzed execution kind: %s", (source, kind) => { expect(compile(source).kind).toBe(kind); });
  it("retains lambda expressions as executable bodies, not docstrings", () => {
    const code = compile('x=lambda: "text"');
    expect(code.name).toEqual({ text: "<lambda>" });
    expect(code.docstring).toBeUndefined();
    expect(code.body.kind).toBe("expression");
    expect(code.kind).toBe("function");
  });
  it("retains generator lambda execution kinds", () => {
    expect(compile("x=lambda: (yield 1)").kind).toBe("generator");
  });
  it("strips docs without validating or allocating ignored docstrings", () => {
    expect(() => compile('def f():\n "\\ud800"')).toThrow("surrogates not allowed");
    const code = compile('def f():\n "\\ud800"', true);
    expect(code.docstring).toBeUndefined();
    expect(code.body).toEqual({ kind: "suite", statements: [] });
  });
  it("derives unmangled nested names from the analyzed class scope", () => {
    const analysis = analyzeModule("class C:\n def __f(): pass");
    const code = compileFunction<unknown>(analysis.scopes.children[0].children[0], analysis, { stripDocstring: false }, constants, budget());
    expect(code.name).toEqual({ text: "__f" });
    expect(code.qualifiedName).toEqual({ text: "C.__f" });
  });
  it("does not evaluate defaults, decorators or ignored type syntax", () => {
    const code = compile("@missing()\ndef f[T: missing()](x: missing()=missing()) -> missing(): pass");
    expect(code.name).toEqual({ text: "f" });
    expect(code.kind).toBe("function");
  });
  it("requires metadata for the exact function and scope identities", () => {
    const analysis = analyzeModule("def f(): pass"), other = analyzeModule("def f(): pass");
    expect(() => compileFunction(analysis.scopes.children[0], other, { stripDocstring: false }, constants, budget())).toThrow("missing analyzed function metadata");
  });
  it("rejects class scopes before allocation", () => {
    expect(() => compile("class C: pass")).toThrow("function code requires a function or lambda scope");
  });
  it("checks entry limits before allocating constants", () => {
    const analysis = analyzeModule("def f(): pass");
    expect(() => compileFunction(analysis.scopes.children[0], analysis, { stripDocstring: false }, constants, budget(0))).toThrow(ExecutionLimitError);
  });
});
