import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("assignment expressions", () => {
  it("stores an unevaluated value and a simple name target", () => {
    expect(parseExpression("(answer := compute())")).toMatchObject({ kind: "assignment-expression", target: { kind: "name", spelling: "answer" }, value: { kind: "call" } });
  });

  it("binds less tightly than conditionals and boolean operators", () => {
    expect(parseExpression("(x := a or b if c else d)")).toMatchObject({ kind: "assignment-expression", value: { kind: "conditional", consequent: { kind: "boolean" } } });
    expect(parseExpression("(f := lambda: 1)")).toMatchObject({ value: { kind: "lambda" } });
    expect(parseExpression("(x := (y := 1))")).toMatchObject({ value: { kind: "assignment-expression" } });
  });

  it.each([
    "[x := 1]", "{x := 1}", "(x := 1, y)", "f(x := 1)", "a[x := 1]", "a[x := 1, y]",
    "[y := x for x in xs]", "{y := x for x in xs}", "(y := x for x in xs)", "f(y := x for x in xs)",
    "{(x := 1): 2}", "{1: (x := 2)}", "a[(x := 1):]", "a[:(x := 1)]", "a[::(x := 1)]",
    "f(k=(x := 1))", "f(*(x := xs))", "f(**(x := mapping))", "lambda: (x := 1)",
    "[x for x in xs if (y := x)]", "a if (x := b) else c"
  ])("allows %s", text => { expect(() => parseExpression(text)).not.toThrow(); });

  it.each([
    "x := 1", "(a.b := 1)", "(a[0] := 1)", "((x) := 1)", "(x,y := 1) := 2", "(1 := x)",
    "(x := y := 1)", "(a+b := 1)", "(True := 1)", "(__debug__ := 1)", "(x :=)",
    "{x := 1: 2}", "{1: x := 2}", "a[x := 1:]", "a[:x := 1]", "a[::x := 1]",
    "f(k=x := 1)", "f(*x := xs)", "f(**x := mapping)", "lambda: x := 1", "lambda x=y := 1: x",
    "[x for x in xs if y := x]", "a if x := b else c", "a + x := b", "[x := 1 for x in y := xs]"
  ])("rejects %s", text => { expect(() => parseExpression(text)).toThrow(SyntaxError); });
});
