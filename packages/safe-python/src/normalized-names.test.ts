import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("normalized identifier binding", () => {
  it.each([["𝒙", "x"], ["K", "K"], ["e\u0301", "é"], ["ｉｆ", "if"]])("preserves %s spelling with binding name %s", (spelling, name) => {
    expect(parseExpression(spelling)).toMatchObject({ kind: "name", spelling, name });
  });

  it("normalizes attributes, parameters, keyword arguments, and assignment targets", () => {
    expect(parseExpression("obj.𝒙")).toMatchObject({ kind: "attribute", spelling: "𝒙", name: "x" });
    expect(parseExpression("lambda 𝒙: 𝒙")).toMatchObject({ parameters: [{ spelling: "𝒙", name: "x" }], body: { name: "x" } });
    expect(parseExpression("f(𝒙=1)")).toMatchObject({ arguments: [{ spelling: "𝒙", name: "x" }] });
    expect(parseExpression("(𝒙 := 1)")).toMatchObject({ target: { spelling: "𝒙", name: "x" } });
  });

  it.each([
    "f(__debug__=1)", "f(__ｄebug__=1)",
    "lambda x,𝒙: x", "lambda K,K: K", "lambda é,e\u0301: é", "lambda x,*𝒙: x",
    "f(x=1,𝒙=2)", "f(K=1,K=2)", "[(𝒙:=1) for x in xs]", "[(x:=1) for 𝒙 in xs]",
    "[[(𝒙:=1) for y in ys] for x in xs]", "(__ｄebug__:=1)", "[x for __ｄebug__ in xs]",
    "[x for obj.__ｄebug__ in xs]", "lambda __debug__: 1", "lambda __ｄebug__: 1"
  ])("rejects normalized binding conflict %s", text => { expect(() => parseExpression(text)).toThrow(SyntaxError); });

  it("does not normalize string contents or template source spelling", () => {
    expect(parseExpression('"𝒙"')).toMatchObject({ value: Uint32Array.from([0x1d499]) });
    expect(parseExpression('t"{𝒙=}"')).toMatchObject({ parts: [{ expression: { name: "x" }, expressionText: "𝒙", debugText: "𝒙=" }] });
  });
});
