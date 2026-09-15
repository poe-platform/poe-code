import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { PythonIndentationError } from "./indentation.js";

it.each([" x=1", "x=1\n  y=2", "if True:\n pass\n  pass", "if True:\npass", "def f():\n", "class C:\n# comment\n"])("reports indentation failures with their Python exception class: %s", source => {
  expect(() => parseModule(source, {filename:"indent.py"})).toThrow(PythonIndentationError);
});

describe("module assignment and expression statements", () => {
  it("handles empty modules, comments, semicolons and logical lines", () => {
    expect(parseModule("# comment\n")).toMatchObject({ kind: "module", body: [] });
    expect(parseModule("pass; f();\nx = (\n 1 + 2\n)\n")).toMatchObject({ body: [
      { kind: "pass" }, { kind: "expression-statement", expression: { kind: "call" } },
      { kind: "assignment", value: { kind: "binary" } }
    ] });
  });

  it("retains chained and destructuring assignment targets in order", () => {
    expect(parseModule("a = b = value")).toMatchObject({ body: [{ kind: "assignment", targets: [{ name: "a" }, { name: "b" }], value: { name: "value" } }] });
    expect(parseModule("a, [b, *c] = xs")).toMatchObject({ body: [{ targets: [{ kind: "tuple", items: [{ name: "a" }, { kind: "list" }] }] }] });
    expect(parseModule("obj.x = data[1:] = values")).toMatchObject({ body: [{ targets: [{ kind: "attribute" }, { kind: "subscript" }] }] });
  });

  it.each(["+=", "-=", "*=", "@=", "/=", "//=", "%=", "**=", "<<=", ">>=", "&=", "^=", "|="])("keeps %s as an augmented operation", operator => {
    expect(parseModule(`obj[index()] ${operator} rhs()`)).toMatchObject({ body: [{ kind: "augmented-assignment", operator: operator.slice(0, -1), target: { kind: "subscript" }, value: { kind: "call" } }] });
  });

  it("accepts tuple values, starred values, yield RHSs, and normalized names", () => {
    expect(parseModule("𝒙 = a, *b,")).toMatchObject({ body: [{ targets: [{ name: "x", spelling: "𝒙" }], value: { kind: "tuple" } }] });
    expect(parseModule("a = yield from xs")).toMatchObject({ body: [{ value: { kind: "yield-from" } }] });
    expect(parseModule("a, *b,")).toMatchObject({ body: [{ kind: "expression-statement", expression: { kind: "tuple" } }] });
  });

  it("parses and retains annotation expressions", () => {
    const tree = parseModule("x: Unknown[expensive()] = 1\ny: Missing\nobj.a: Other = 2");
    expect(tree).toMatchObject({ body: [
      { kind: "annotated-assignment", target: { name: "x" }, value: { value: 1n } },
      { kind: "annotated-assignment", target: { name: "y" }, value: null },
      { kind: "annotated-assignment", target: { kind: "attribute" }, value: { value: 2n } }
    ] });
    expect(JSON.stringify(tree, (_, value) => typeof value === "bigint" ? String(value) : value)).toContain("expensive");
    expect(() => parseModule("x: [(y:=1) for y in ys] = 1")).toThrow(SyntaxError);
  });

  it("applies expression scope validation", () => {
    expect(() => parseModule("x = [(y:=1) for y in ys]")).toThrow(SyntaxError);
    expect(parseModule('s = t"{x # comment\n=}"')).toMatchObject({ body: [{ value: { parts: [{ debugText: "x \n=" }] } }] });
  });

  it.each(["a =", "1 = x", "f() = x", "a+b = x", "a,*b,*c = xs", "*a = xs", "a = *xs", "__debug__ = 1", "__ｄebug__ += 1", "a,b += xs", "[a] += xs", "a,b: T = xs", "a: = 1", "a: T = b = 1", "a;;b", ";a", "a b", "  a = 1", "x := 1"])
    ("rejects invalid statement %s", text => { expect(() => parseModule(text)).toThrow(SyntaxError); });
});
