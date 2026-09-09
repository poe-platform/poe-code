import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("for statements", () => {
  it("parses unpacking targets, iterable tuples, and else suites", () => {
    expect(parseModule("for x, *rest in first, *others:\n pass\nelse: done()\nafter()"))
      .toMatchObject({ body: [
        { kind: "for", async: false, target: { kind: "tuple", items: [{ name: "x" }, { kind: "unpack" }] },
          iterable: { kind: "tuple", items: [{ name: "first" }, { kind: "unpack" }] },
          body: [{ kind: "pass" }], otherwise: [{ kind: "expression-statement" }] },
        { kind: "expression-statement" }
      ] });
  });

  it("parses async loops with nested conditionals", () => {
    expect(parseModule("async for obj.x in source:\n if ready: continue\n else: break\nelse:\n pass"))
      .toMatchObject({ body: [{ kind: "for", async: true, target: { kind: "attribute" },
        body: [{ kind: "if" }], otherwise: [{ kind: "pass" }] }] });
  });

  it("allows named expressions in parenthesized iterables and target subscripts", () => {
    expect(parseModule("for obj[(i := 1)] in (xs := source): pass"))
      .toMatchObject({ body: [{ target: { kind: "subscript" }, iterable: { kind: "assignment-expression" } }] });
  });

  it("validates executable expressions in every loop component", () => {
    for (const text of ["for x in [(a:=1) for a in xs]: pass", "for obj[[(a:=1) for a in xs]] in xs: pass",
      "for x in xs:\n y = [(a:=1) for a in xs]", "for x in xs: pass\nelse: y = [(a:=1) for a in xs]"]) {
      expect(() => parseModule(text)).toThrow(SyntaxError);
    }
  });

  it.each(["for x xs: pass", "for in xs: pass", "for f() in xs: pass", "for *x in xs: pass",
    "for x, *y, *z in xs: pass", "for __debug__ in xs: pass", "for x in yield xs: pass",
    "for x in xs := source: pass", "for x in *xs: pass", "for x in xs:", "async while x: pass",
    "for x in xs: for y in ys: pass", "for x in xs: pass\nelif y: pass"])
    ("rejects invalid loop %s", text => { expect(() => parseModule(text)).toThrow(SyntaxError); });
});
