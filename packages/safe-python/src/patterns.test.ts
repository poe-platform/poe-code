import { describe, expect, it } from "vitest";
import { parsePattern } from "./patterns.js";

describe("pattern grammar", () => {
  it("retains nested sequence boundaries and accepts a sole list star", () => {
    expect(parsePattern("[(a,b)]")).toMatchObject({ kind: "sequence", items: [{ kind: "sequence", items: [{ kind: "capture" }, { kind: "capture" }] }] });
    expect(parsePattern("[*rest]")).toMatchObject({ kind: "sequence", items: [{ kind: "star" }] });
    expect(() => parsePattern("(*rest)")).toThrow(SyntaxError);
  });
  it("parses captures, wildcard, dotted values, and singleton patterns", () => {
    expect(parsePattern("K")).toMatchObject({ kind: "capture", name: { name: "K", spelling: "K" } });
    expect(parsePattern("_")).toMatchObject({ kind: "capture", name: null });
    expect(parsePattern("Color.RED")).toMatchObject({ kind: "value", value: { kind: "attribute", name: "RED" } });
    expect(parsePattern("None")).toMatchObject({ kind: "singleton", value: { value: null } });
  });

  it("parses strings and signed numeric/complex literals", () => {
    expect(parsePattern("'a' 'b'")).toMatchObject({ kind: "value", value: { value: new Uint32Array([97,98]) } });
    expect(parsePattern("-2")).toMatchObject({ value: { kind: "unary", operator: "-", operand: { value: 2n } } });
    expect(parsePattern("-1+2j")).toMatchObject({ value: { kind: "binary", operator: "+", right: { literalKind: "imaginary", value: 2 } } });
  });

  it("parses grouped, open, and bracketed sequences with star captures", () => {
    expect(parsePattern("(x)")).toMatchObject({ kind: "capture" });
    expect(parsePattern("x, *rest")).toMatchObject({ kind: "sequence", items: [{ kind: "capture" }, { kind: "star", name: { name: "rest" } }] });
    expect(parsePattern("[1, (x, y), *_]")).toMatchObject({ kind: "sequence", items: [{ kind: "value" }, { kind: "sequence" }, { kind: "star", name: null }] });
    expect(parsePattern("()")).toMatchObject({ kind: "sequence", items: [] });
  });

  it("parses alternatives and lower-precedence as bindings", () => {
    expect(parsePattern("1 | 2 as result")).toMatchObject({ kind: "as", pattern: { kind: "or", patterns: [{ kind: "value" }, { kind: "value" }] }, name: { name: "result" } });
  });

  it("parses mappings and class patterns", () => {
    expect(parsePattern("{'x': [a, *rest], Keys.Y: b, **extra}"))
      .toMatchObject({ kind: "mapping", entries: [{ pattern: { kind: "sequence" } }, { key: { kind: "attribute" } }], rest: { name: "extra" } });
    expect(parsePattern("mod.Point(x, y=1 | 2)"))
      .toMatchObject({ kind: "class", class: { kind: "attribute", name: "Point" }, positional: [{ kind: "capture" }], keywords: [{ name: { name: "y" }, pattern: { kind: "or" } }] });
  });

  it.each(["", "+1", "1+2", "1j+2j", "--1", "...", "f'x'", "t'x'", "x+y", "x[0]", "x := y", "1 as _",
    "__debug__", "1 as __debug__", "*x", "{x: y}", "{**_}", "{**x, 'a': y}", "C(*x)", "C(x=y,z)", "C(**x)", "[x", "x |", "x as y as z", "_(x)", "_.x"])
    ("rejects malformed pattern %s", source => { expect(() => parsePattern(source)).toThrow(SyntaxError); });
});
