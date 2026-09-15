import { describe, expect, it } from "vitest";
import { parseExpression } from "./expression.js";

describe("Python collection displays", () => {
  it("distinguishes empty and singleton collections from grouping", () => {
    expect(parseExpression("()")).toMatchObject({ kind: "tuple", items: [] });
    expect(parseExpression("[]")).toMatchObject({ kind: "list", items: [] });
    expect(parseExpression("{}")).toMatchObject({ kind: "dictionary", entries: [] });
    expect(parseExpression("(a)")).toMatchObject({ kind: "name", spelling: "a" });
    expect(parseExpression("(a,)")).toMatchObject({ kind: "tuple", items: [{ spelling: "a" }] });
    expect(parseExpression("{a}")).toMatchObject({ kind: "set", items: [{ spelling: "a" }] });
  });
  it("parses bare tuples while leaving argument commas to call parsing", () => {
    expect(parseExpression("a, b, c,")).toMatchObject({ kind: "tuple", items: [{ spelling: "a" }, { spelling: "b" }, { spelling: "c" }] });
    expect(parseExpression("f(a, b)")).toMatchObject({ kind: "call", arguments: [{ value: { spelling: "a" } }, { value: { spelling: "b" } }] });
  });
  it.each(["[a, *b, c,]", "(a, *b, c,)", "{a, *b, c,}"])("preserves iterable unpacking in %s", (source) => {
    expect(parseExpression(source)).toMatchObject({ items: [
      { spelling: "a" }, { kind: "unpack", value: { spelling: "b" } }, { spelling: "c" }
    ] });
  });
  it("preserves dictionary item and mapping-unpack order", () => {
    expect(parseExpression("{a: b, **c, d: e, **f,}")).toMatchObject({ kind: "dictionary", entries: [
      { kind: "entry", key: { spelling: "a" }, value: { spelling: "b" } },
      { kind: "mapping", value: { spelling: "c" } },
      { kind: "entry", key: { spelling: "d" }, value: { spelling: "e" } },
      { kind: "mapping", value: { spelling: "f" } }
    ] });
  });
  it("permits duplicate dictionary keys without discarding either expression", () => {
    expect(parseExpression("{a: first(), a: second()}")).toMatchObject({ entries: [
      { key: { spelling: "a" }, value: { callee: { spelling: "first" } } },
      { key: { spelling: "a" }, value: { callee: { spelling: "second" } } }
    ] });
  });
  it("nests collections and supports trailers on displays", () => {
    expect(parseExpression("{'a': [1, (2, 3)]}['a'][0]")).toMatchObject({
      kind: "subscript", object: { kind: "subscript", object: { kind: "dictionary", entries: [{ value: {
        kind: "list", items: [{ value: 1n }, { kind: "tuple", items: [{ value: 2n }, { value: 3n }] }]
      } }] } }
    });
    expect(parseExpression("a[()]")).toMatchObject({ tuple: false, items: [{ kind: "tuple", items: [] }] });
  });
  it("allows parenthesized conditionals in unpacking but excludes unparenthesized boolean expressions", () => {
    expect(parseExpression("[*(a if b else c)]")).toMatchObject({ items: [{ kind: "unpack", value: { kind: "conditional" } }] });
    expect(parseExpression("{**(a or b)}")).toMatchObject({ entries: [{ kind: "mapping", value: { kind: "boolean" } }] });
  });
  it.each(["(,)", "[a,,b]", "{a,,b}", "{a:b,c}", "{a,b:c}", "{**a,b}", "{a,**b}", "[**a]", "(*a)", "[*a or b]", "[*a if b else c]", "{**a or b}", "{**a if b else c}", "a,,", "*a,"])(
    "rejects malformed display %s", (source) => { expect(() => parseExpression(source)).toThrow(SyntaxError); }
  );
});
