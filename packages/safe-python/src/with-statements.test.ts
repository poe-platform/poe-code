import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("with statements", () => {
  it("parses ordered managers and unpacking targets", () => {
    expect(parseModule("with first as (a, *b), second as obj.x:\n pass"))
      .toMatchObject({ body: [{ kind: "with", async: false, items: [
        { context: { name: "first" }, target: { kind: "tuple" } },
        { context: { name: "second" }, target: { kind: "attribute" } }
      ], body: [{ kind: "pass" }] }] });
  });

  it("parses async parenthesized manager lists", () => {
    expect(parseModule("async with (\n first as a,\n second,\n): pass"))
      .toMatchObject({ body: [{ kind: "with", async: true, items: [
        { context: { name: "first" }, target: { name: "a" } }, { context: { name: "second" }, target: null }
      ] }] });
  });

  it("distinguishes manager-list parentheses from expression parentheses", () => {
    for (const [header, kinds] of [
      ["(a,b)", ["name", "name"]], ["(a,b) as x", ["tuple"]], ["(a,b),c", ["tuple", "name"]],
      ["()", ["tuple"]], ["(a,)", ["name"]], ["(a).x", ["attribute"]],
      ["(x := a)", ["assignment-expression"]], ["(a for a in xs)", ["comprehension"]]
    ] as const) {
      const statement = parseModule(`with ${header}: pass`).body[0];
      expect(statement.kind).toBe("with");
      if (statement.kind === "with") expect(statement.items.map(item => item.context.kind)).toEqual(kinds);
    }
  });

  it("validates manager, target, and body expressions", () => {
    const bad = "[(x:=1) for x in xs]";
    for (const header of [bad, `a as obj[${bad}]`]) expect(() => parseModule(`with ${header}: pass`)).toThrow(SyntaxError);
    expect(() => parseModule(`with a: ${bad}`)).toThrow(SyntaxError);
  });

  it.each(["a,", "(a),", "a as f()", "a as __debug__", "a as *x", "a as (x,*y,*z)", "a as x+y", "a := b", "(a as x),b", "(a as x", "(a, $)"])
    ("rejects invalid header %s", header => { expect(() => parseModule(`with ${header}: pass`)).toThrow(SyntaxError); });
});
