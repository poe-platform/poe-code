import { describe, expect, it } from "vitest";
import { analyzeModule } from "./analysis.js";

// CPython 3.14.7, Unicode 16.0.0: compile(source, "audit.py", "exec").
const contexts = [
  ["def f[T: EXPR](): pass", "TypeVar bound"],
  ["def f[T: (EXPR, int)](): pass", "TypeVar constraint"],
  ["def f[T = EXPR](): pass", "TypeVar default"],
  ["def f[*Ts = EXPR](): pass", "TypeVarTuple default"],
  ["def f[**P = EXPR](): pass", "ParamSpec default"],
  ["class C[T: EXPR]: pass", "TypeVar bound"],
  ["type A = EXPR", "type alias"],
] as const;

describe.each(contexts)("annotation scope: %s", (template, context) => {
  it.each([
    ["(x:=1)", "named"],
    ["(yield 1)", "yield"],
    ["(yield from xs)", "yield"],
    ["await x", "await"],
    ["lambda x=(y:=1): x", "named"],
  ])("rejects %s in the enclosing annotation scope", (expression, kind) => {
    const source = template.replace("EXPR", expression);
    expect(() => analyzeModule(source, { filename: "audit.py" }))
      .toThrow(`${kind} expression cannot be used within a ${context}`);
  });

  it.each(["lambda: (x:=1)", "lambda: (yield 1)", "lambda: [(y:=x) for x in xs]", "missing()"])
    ("accepts %s without evaluating it", expression => {
      expect(() => analyzeModule(template.replace("EXPR", expression))).not.toThrow();
    });

  it("rejects a comprehension that rebinds its iteration variable", () => {
    expect(() => analyzeModule(template.replace("EXPR", "[(x:=1) for x in xs]")))
      .toThrow("assignment expression cannot rebind comprehension iteration variable 'x'");
  });
});

it("retains the exact direct-bound diagnostic span and source line", () => {
  const source = "def f[T: (x:=1)](): pass";
  expect(() => analyzeModule(source, { filename: "audit.py" })).toThrowError(expect.objectContaining({
    filename: "audit.py", message: "named expression cannot be used within a TypeVar bound",
    position: { offset: 10, line: 1, column: 10 },
    endPosition: { offset: 14, line: 1, column: 14 },
    sourceLine: source,
  }));
});

it.each(contexts)("rejects comprehension writes into %s", (template, context) => {
  const scope = context === "type alias" ? "type alias" : "TypeVar bound";
  expect(() => analyzeModule(template.replace("EXPR", "[(y:=x) for x in xs]")))
    .toThrow(`assignment expression within a comprehension cannot be used in a ${scope}`);
});

it("keeps the first comprehension iterable in the enclosing annotation scope", () => {
  expect(() => analyzeModule("type A = (x for x in (y:=xs))"))
    .toThrow("named expression cannot be used within a type alias");
});

it("reports the complete iteration-variable diagnostic span", () => {
  expect(() => analyzeModule("type A = [(x:=1) for x in xs]", { filename: "audit.py" }))
    .toThrowError(expect.objectContaining({
      position: { offset: 11, line: 1, column: 11 },
      endPosition: { offset: 12, line: 1, column: 12 },
    }));
});

it("validates nested type expressions through every container without executing names", () => {
  for (const expression of ["call(key=[{1: (x:=1)}])", "f'{(x:=1)}'", "t'{(x:=1)}'", "a[(x:=1):]"]) {
    expect(() => analyzeModule(`type A = ${expression}`))
      .toThrow("named expression cannot be used within a type alias");
  }
  expect(() => analyzeModule(`type A = ${"[".repeat(80)}(x:=1)${"]".repeat(80)}`))
    .toThrow("named expression cannot be used within a type alias");
});
