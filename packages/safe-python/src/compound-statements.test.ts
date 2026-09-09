import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("compound statement suites", () => {
  it("parses ordered if/elif/else branches and the following statement", () => {
    expect(parseModule("if a:\n x = 1\nelif b:\n x = 2\nelse:\n x = 3\ny = 4")).toMatchObject({ body: [
      { kind: "if", branches: [{ condition: { name: "a" }, body: [{ kind: "assignment" }] }, { condition: { name: "b" }, body: [{ kind: "assignment" }] }], otherwise: [{ kind: "assignment" }] },
      { kind: "assignment", targets: [{ name: "y" }] }
    ] });
  });

  it("handles single-line semicolon suites and absent else clauses", () => {
    expect(parseModule("if a: f(); g();\nwhile b: break\n")).toMatchObject({ body: [
      { kind: "if", branches: [{ body: [{ kind: "expression-statement" }, { kind: "expression-statement" }] }], otherwise: [] },
      { kind: "while", condition: { name: "b" }, body: [{ kind: "break" }], otherwise: [] }
    ] });
  });

  it("keeps nested dedents and else ownership correct", () => {
    expect(parseModule("while a:\n if b:\n  break\n else:\n  continue\nelse:\n done()\n")).toMatchObject({ body: [
      { kind: "while", body: [{ kind: "if", otherwise: [{ kind: "continue" }] }], otherwise: [{ kind: "expression-statement" }] }
    ] });
  });

  it("accepts named conditions and blank/comment-only lines", () => {
    expect(parseModule("if x := f():\n # comment\n\n pass\nwhile (y := g()):\n pass\nelse: done()"))
      .toMatchObject({ body: [{ branches: [{ condition: { kind: "assignment-expression" } }] }, { condition: { kind: "assignment-expression" } }] });
  });

  it("validates expressions nested in suites and branch conditions", () => {
    expect(() => parseModule("if [(x:=1) for x in xs]: pass")).toThrow(SyntaxError);
    expect(() => parseModule("while x:\n if y:\n  z = [(a:=1) for a in xs]")).toThrow(SyntaxError);
  });

  it.each(["if x", "if x:", "if x:\npass", "if x: # comment\n", "if x: if y: pass", "pass; if x: pass", "else: pass", "elif x: pass", "while x:\n  pass\n pass", "if x:\n pass\nelse:\n", "while x: pass\nelif y: pass", "if x: pass\nelse: pass\nelse: pass"])
    ("rejects invalid suite %s", text => { expect(() => parseModule(text)).toThrow(SyntaxError); });
});
