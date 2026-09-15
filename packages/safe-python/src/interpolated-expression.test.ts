import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("interpolated expression trees", () => {
  it.each(["f", "t"])("parses %s literal text and fields without evaluating them", prefix => {
    expect(parseExpression(`${prefix}"hello {name}!"`)).toMatchObject({ kind: "interpolated-string", flavor: prefix === "f" ? "formatted" : "template", parts: [
      { kind: "text", value: Uint32Array.from([104, 101, 108, 108, 111, 32]) },
      { kind: "field", expression: { kind: "name", spelling: "name" }, conversion: null, format: null },
      { kind: "text", value: Uint32Array.from([33]) }
    ] });
  });

  it("retains debug whitespace and template expression spelling", () => {
    expect(parseExpression('t"{ x + 1 = }"')).toMatchObject({ parts: [{ kind: "field", expressionText: " x + 1", debugText: " x + 1 = ", conversion: "r" }] });
    expect(parseExpression('f"{x=:}"')).toMatchObject({ parts: [{ debugText: "x=", conversion: null, format: [] }] });
  });

  it("omits comments from debug/template spelling without stripping string contents", () => {
    expect(parseExpression('f"{x # comment\n=}"')).toMatchObject({ parts: [{ debugText: "x \n=" }] });
    expect(parseExpression('t"{"#not a comment" # comment\n}"')).toMatchObject({ parts: [{ expressionText: '"#not a comment"' }] });
  });

  it("keeps comment ranges ordered and forwards the lexer callback", () => {
    const comments: string[] = [];
    const source = 't"""{x # first\r\n=} {y # second\n=}"""';
    expect(parseExpression(source, { onComment: span => comments.push(source.slice(span.start.offset, span.end.offset)) }))
      .toMatchObject({ parts: [{ debugText: "x \n=" }, { kind: "text" }, { debugText: "y \n=" }] });
    expect(comments).toEqual(["# first", "# second"]);
  });

  it("parses explicit conversions and recursively nested format fields", () => {
    expect(parseExpression('f"{x!a:>{w}.{p}f}"')).toMatchObject({ parts: [{ conversion: "a", format: [
      { kind: "text" }, { kind: "field", expression: { spelling: "w" } }, { kind: "text" }, { kind: "field", expression: { spelling: "p" } }, { kind: "text" }
    ] }] });
    expect(parseExpression('f"{x:{w:{p}}}"')).toMatchObject({ parts: [{ format: [{ format: [{ expression: { spelling: "p" } }] }] }] });
  });

  it("parses tuple fields, starred fields and nested strings", () => {
    expect(parseExpression('f"{x,y}"')).toMatchObject({ parts: [{ expression: { kind: "tuple", items: [{ spelling: "x" }, { spelling: "y" }] } }] });
    expect(parseExpression('f"{*xs,}"')).toMatchObject({ parts: [{ expression: { kind: "tuple", items: [{ kind: "unpack" }] } }] });
    expect(parseExpression('f"{f"{x}"}"')).toMatchObject({ parts: [{ expression: { kind: "interpolated-string" } }] });
    expect(parseExpression('f"{(x := 1)}"')).toMatchObject({ parts: [{ expression: { kind: "assignment-expression" } }] });
    expect(parseExpression('f"{x:=10}"')).toMatchObject({ parts: [{ expression: { kind: "name" }, format: [{ value: Uint32Array.from([61, 49, 48]) }] }] });
  });

  it("applies scope checks inside fields and format specifications", () => {
    expect(() => parseExpression('[f"{(x:=1)}" for x in xs]')).toThrow(SyntaxError);
    expect(() => parseExpression('[f"{y:{(x:=1)}}" for x in xs]')).toThrow(SyntaxError);
    expect(() => parseExpression('[x for x in t"{(y:=xs)}"]')).toThrow(SyntaxError);
  });

  it.each(['f"{}"', 'f"{x!q}"', 'f"{x! r}"', 'f"{x!rr}"', 'f"{x!}"', 'f"{x!r!s}"', 'f"{*x}"', 'f"{lambda: x}"', 'f"{x y}"'])
    ("rejects invalid field %s", text => { expect(() => parseExpression(text)).toThrow(SyntaxError); });
});
