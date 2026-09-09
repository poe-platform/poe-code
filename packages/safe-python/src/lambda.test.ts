import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("Python lambda expressions", () => {
  it("parses every parameter category and default expression", () => {
    expect(parseExpression("lambda a, b=1, /, c=2, *args, d, e=3, **kwargs: a + c")).toMatchObject({
      kind: "lambda", parameters: [
        { spelling: "a", kind: "positional-only", default: null },
        { spelling: "b", kind: "positional-only", default: { value: 1n } },
        { spelling: "c", kind: "positional-or-keyword", default: { value: 2n } },
        { spelling: "args", kind: "var-positional", default: null },
        { spelling: "d", kind: "keyword-only", default: null },
        { spelling: "e", kind: "keyword-only", default: { value: 3n } },
        { spelling: "kwargs", kind: "var-keyword", default: null }
      ], body: { kind: "binary", operator: "+" }
    });
  });
  it("handles empty parameter lists, bare stars, and trailing commas", () => {
    expect(parseExpression("lambda: None")).toMatchObject({ kind: "lambda", parameters: [], body: { literalKind: "none" } });
    expect(parseExpression("lambda *, x, y=2,: x")).toMatchObject({ parameters: [
      { kind: "keyword-only", spelling: "x" }, { kind: "keyword-only", spelling: "y" }
    ] });
    expect(parseExpression("lambda x, /,: x")).toMatchObject({ parameters: [{ kind: "positional-only" }] });
  });
  it("gives lambda lower precedence than conditionals and operators", () => {
    expect(parseExpression("lambda x: x if x else 0")).toMatchObject({ kind: "lambda", body: { kind: "conditional" } });
    expect(parseExpression("a if b else lambda: c")).toMatchObject({ kind: "conditional", alternate: { kind: "lambda" } });
    expect(parseExpression("(lambda x: x + 1)(2)")).toMatchObject({ kind: "call", callee: { kind: "lambda" } });
  });
  it("retains nested lambdas and defaults as unevaluated expressions", () => {
    expect(parseExpression("lambda f=lambda x: x, n=make(): lambda: f(n)")).toMatchObject({
      kind: "lambda", parameters: [{ default: { kind: "lambda" } }, { default: { kind: "call" } }],
      body: { kind: "lambda", body: { kind: "call" } }
    });
  });
  it.each([
    "lambda x=1,y: x", "lambda x=1,/,y: x", "lambda x,x: x", "lambda x,*x: x", "lambda *x,**x: x",
    "lambda /: x", "lambda x,/,/: x", "lambda *x,/: x", "lambda *: x", "lambda *,**x: x",
    "lambda *x,*y: x", "lambda **x,y: x", "lambda *x=1: x", "lambda **x=1: x",
    "lambda True: x", "lambda (x): x", "lambda x", "lambda: ", "a + lambda: b", "a if lambda: b else c"
  ])("rejects invalid lambda %s", (text) => { expect(() => parseExpression(text)).toThrow(SyntaxError); });
});
