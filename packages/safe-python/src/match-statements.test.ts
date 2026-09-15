import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("match statements", () => {
  it("parses ordered cases, guards, and nested suites", () => {
    expect(parseModule("match subject:\n case [x, *rest] if ready:\n  use(x)\n case _:\n  pass\nafter()"))
      .toMatchObject({ body: [{ kind: "match", subject: { name: "subject" }, cases: [
        { pattern: { kind: "sequence" }, guard: { name: "ready" }, body: [{ kind: "expression-statement" }] },
        { pattern: { kind: "capture", name: null }, guard: null, body: [{ kind: "pass" }] }
      ] }, { kind: "expression-statement" }] });
  });

  it("accepts named subjects, tuple unpacking, and named guards", () => {
    expect(parseModule("match first := f(), *rest:\n case _ if ready := check(): pass"))
      .toMatchObject({ body: [{ subject: { kind: "tuple", items: [{ kind: "assignment-expression" }, { kind: "unpack" }] },
        cases: [{ guard: { kind: "assignment-expression" } }] }] });
  });

  it("keeps match and case soft outside their grammar positions", () => {
    expect(parseModule("match = f; match(x); match: T; case = 1\nmatch case:\n case case: pass"))
      .toMatchObject({ body: [{ kind: "assignment" }, { kind: "expression-statement" }, { kind: "annotated-assignment" },
        { kind: "assignment" }, { kind: "match", cases: [{ pattern: { name: { name: "case" } } }] }] });
  });

  it("allows equivalent alternative captures and guarded irrefutable cases", () => {
    expect(() => parseModule("match x:\n case [a,b] | [b,a]: pass\n case name if condition: pass\n case _: pass")).not.toThrow();
    expect(() => parseModule("match x:\n case [K] | [K]: pass\n case [a] | a: pass")).not.toThrow();
  });

  it("validates subjects, guards, and bodies as executable expressions", () => {
    const bad = "[(x:=1) for x in xs]";
    for (const source of [`match ${bad}:\n case _: pass`, `match x:\n case _ if ${bad}: pass`, `match x:\n case _: ${bad}`]) {
      expect(() => parseModule(source)).toThrow(SyntaxError);
    }
  });

  it.each(["[x,x]", "[K,K]", "[x] as x", "{'a': x, **x}", "C(x, attr=x)", "[x] | [y]", "_ | 1", "x | x", "[*a,*b]", "[*_,*_]"])
    ("rejects invalid bindings in %s", pattern => { expect(() => parseModule(`match subject:\n case ${pattern}: pass`)).toThrow(SyntaxError); });

  it.each(["match x: case _: pass", "match x:\n pass", "match x:\n", "match x:\n case _: pass\n case 1: pass",
    "match x:\n case name: pass\n case _: pass", "match *xs:\n case _: pass", "match x:\n case 1:", "match x:\n case 1: pass\n else: pass"])
    ("rejects malformed or unreachable match %s", source => { expect(() => parseModule(source)).toThrow(SyntaxError); });
});
