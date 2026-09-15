import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("comprehension expressions", () => {
  it.each([ ["[x for x in xs]", "list"], ["{x for x in xs}", "set"], ["(x for x in xs)", "generator"] ])("parses %s", (text, collection) => {
    expect(parseExpression(text)).toMatchObject({ kind: "comprehension", collection, element: { kind: "name", spelling: "x" }, clauses: [
      { async: false, target: { kind: "name", spelling: "x" }, iterable: { kind: "name", spelling: "xs" }, filters: [] }
    ] });
  });

  it("parses ordered dictionary keys and values", () => {
    expect(parseExpression("{key(x): value(x) for x in xs}")).toMatchObject({ kind: "dictionary-comprehension", key: { kind: "call" }, value: { kind: "call" } });
  });

  it("retains nested loops, filters and asynchronous clauses", () => {
    expect(parseExpression("[x+y async for x in xs if x if valid(x) for y in ys if y]")).toMatchObject({ clauses: [
      { async: true, filters: [{ kind: "name" }, { kind: "call" }] }, { async: false, filters: [{ kind: "name" }] }
    ] });
  });

  it("accepts destructuring, attribute and subscript targets", () => {
    expect(parseExpression("[x for (x, [y, *z]), obj.attr, obj[0] in xs]")).toMatchObject({ clauses: [{ target: { kind: "tuple", items: [
      { kind: "tuple" }, { kind: "attribute" }, { kind: "subscript" }
    ] } }] });
  });

  it("accepts a generator expression as the sole unparenthesized call argument", () => {
    expect(parseExpression("sum(x for x in xs if x)")).toMatchObject({ kind: "call", arguments: [{ kind: "positional", value: { kind: "comprehension", collection: "generator" } }] });
    expect(parseExpression("f((x for x in xs), other)")).toMatchObject({ arguments: [{ value: { collection: "generator" } }, { value: { kind: "name" } }] });
  });

  it("allows grouped conditionals in iterables and filters", () => {
    expect(parseExpression("[x if x else 0 for x in (a if b else c) if (d if e else f)]")).toMatchObject({ element: { kind: "conditional" }, clauses: [{ iterable: { kind: "conditional" }, filters: [{ kind: "conditional" }] }] });
  });

  it("includes the surrounding parentheses in a bare call generator's span", () => {
    expect(parseExpression("f(x for x in xs)")).toMatchObject({ arguments: [{ value: {
      start: { offset: 1 }, end: { offset: 16 }
    } }] });
  });

  it.each([
    "[x for __debug__ in xs]", "[x for obj.__debug__ in xs]", "[x for [__debug__] in xs]",
    "[*x for x in xs]", "{**x for x in xs}", "[x, y for x in xs]", "[x for x in xs,]",
    "[x for 1 in xs]", "[x for f() in xs]", "[x for a+b in xs]", "[x for *a in xs]",
    "[x for a,*b,*c in xs]", "[x for [*a,*b] in xs]", "[x for {a} in xs]",
    "[x for x in a if b else c]", "[x for x in lambda: a]", "[x for x in a if lambda: b]",
    "f(x for x in xs,)", "f(a, x for x in xs)", "f(x for x in xs, a)", "f(k=x for x in xs)",
    "[x async x in xs]", "[x for x xs]", "[x for x in]", "[x for x in xs if]"
  ])("rejects invalid comprehension %s", text => {
    expect(() => parseExpression(text)).toThrow(SyntaxError);
  });
});
