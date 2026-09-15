import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("suspension expression syntax", () => {
  it("binds await to a primary, more tightly than exponentiation", () => {
    expect(parseExpression("await task().value[0] ** 2")).toMatchObject({ kind: "binary", operator: "**", left: { kind: "await", value: { kind: "subscript" } } });
    expect(parseExpression("-await task()")).toMatchObject({ kind: "unary", operand: { kind: "await" } });
    expect(parseExpression("await (await task())")).toMatchObject({ kind: "await", value: { kind: "await" } });
  });

  it("parses empty, single-value, and tuple yields", () => {
    expect(parseExpression("(yield)")).toMatchObject({ kind: "yield", value: null });
    expect(parseExpression("(yield x + 1)")).toMatchObject({ kind: "yield", value: { kind: "binary" } });
    expect(parseExpression("(yield x, *ys,)")).toMatchObject({ kind: "yield", value: { kind: "tuple", items: [{ kind: "name" }, { kind: "unpack" }] } });
    expect(parseExpression("lambda: (yield 1)")).toMatchObject({ kind: "lambda", body: { kind: "yield" } });
  });

  it("parses yield-from as a distinct delegation operation", () => {
    expect(parseExpression("(yield from xs if flag else ys)")).toMatchObject({ kind: "yield-from", value: { kind: "conditional" } });
    expect(parseExpression("f((yield from xs))")).toMatchObject({ arguments: [{ value: { kind: "yield-from" } }] });
  });

  it("accepts suspension expressions in replacement fields", () => {
    expect(parseExpression('f"{yield}"')).toMatchObject({ parts: [{ expression: { kind: "yield", value: null } }] });
    expect(parseExpression('f"{yield x,y}"')).toMatchObject({ parts: [{ expression: { kind: "yield", value: { kind: "tuple" } } }] });
    expect(parseExpression('t"{yield from xs}"')).toMatchObject({ parts: [{ expression: { kind: "yield-from" } }] });
    expect(parseExpression('f"{await task()}"')).toMatchObject({ parts: [{ expression: { kind: "await" } }] });
  });

  it("visits assignment expressions inside suspended values", () => {
    expect(() => parseExpression("[await (x:=1) for x in xs]")).toThrow(SyntaxError);
    expect(() => parseExpression("[y for y in (yield (x:=xs))]")).toThrow(SyntaxError);
  });

  it.each(["await", "await -x", "await await x", "await lambda: x", "yield x", "[yield x]", "f(yield x)", "lambda: yield x", "(yield from)", "(yield from x,y)", "(yield x for x in xs)", "(yield *x)"])
    ("rejects invalid suspension grammar %s", text => { expect(() => parseExpression(text)).toThrow(SyntaxError); });
});
