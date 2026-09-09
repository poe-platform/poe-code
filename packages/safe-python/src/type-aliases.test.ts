import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { statementExpressions } from "./statement-expressions.js";

describe("ignored type aliases", () => {
  it("parses normalized aliases with generic parameters and discards their values", () => {
    const module = parseModule("type K[T: Bound = Default, *Ts = *tuple[A,B], **P = Params] = Callable[P, T]");
    expect(module).toMatchObject({ body: [{ kind: "type-alias", name: { name: "K", spelling: "K" } }] });
    expect(module.body[0]).not.toHaveProperty("value");
    expect([...statementExpressions(module.body[0])]).toEqual([]);
  });

  it("accepts aliases inside suites and semicolon-separated simple statements", () => {
    expect(parseModule("type A = int; type B = str\ndef f():\n type C[T] = list[T]\n return 1\nclass D:\n type E = tuple[int, ...]"))
      .toMatchObject({ body: [{ kind: "type-alias" }, { kind: "type-alias" },
        { body: [{ kind: "type-alias" }, { kind: "return" }] }, { body: [{ kind: "type-alias" }] }] });
  });

  it("keeps type soft in expressions, assignments, and alias names", () => {
    expect(parseModule("type = factory; type(x); type[T] = value; type.attr; type is None; type type = type"))
      .toMatchObject({ body: [{ kind: "assignment" }, { kind: "expression-statement" }, { kind: "assignment" },
        { kind: "expression-statement" }, { kind: "expression-statement" }, { kind: "type-alias", name: { name: "type" } }] });
  });

  it("parses ignored expressions without applying executable-scope validation", () => {
    expect(() => parseModule("type A = [(x:=1) for x in xs]")).not.toThrow();
    expect(() => parseModule("type A[T = missing()] = other_missing()")).not.toThrow();
    expect(() => parseModule("type A = list[int]; [(x:=1) for x in xs]")).toThrow(SyntaxError);
  });

  it.each(["type A", "type A =", "type A = int, str", "type A = *Ts", "type A = x := T", "type A[] = int",
    "type A[T,T] = T", "type A[T=U,V] = T", "type __debug__ = int", "type if = int", "type A.x = int",
    "type A: int = str", "type (A) = int", "type A = int = str", "type A[T] = yield T"])
    ("rejects malformed alias %s", source => { expect(() => parseModule(source)).toThrow(SyntaxError); });
});
