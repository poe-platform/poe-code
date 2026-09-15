import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { collectSymbols } from "./symbol-collection.js";
import { validateDeclarations } from "./declaration-validation.js";

describe("scope declaration conflicts", () => {
  it.each([
    "global x\nglobal x", "import x\nglobal x", "from m import x\nglobal x", "(x): T\nglobal x",
    "[x for x in xs]\nglobal x", "global x\nx = value", "nonlocal x\nx = value",
    "global x\nobj.x = value", "def inner():\n x = value\nglobal x"
  ])("accepts compatible declaration events: %s", body => {
    const source = `def outer():\n x = 1\n def f():\n${body.split("\n").map(line => `  ${line}`).join("\n")}`;
    expect(() => validateDeclarations(collectSymbols(parseModule(source)))).not.toThrow();
  });

  it.each([
    "x\nglobal x", "x = value\nglobal x", "del x\nglobal x", "x += 1\nglobal x", "x: T\nglobal x",
    "global x\nx: T", "nonlocal x\nx: T", "x: T\nnonlocal x", "global x\nnonlocal x", "nonlocal x\nglobal x",
    "global x\nx\nglobal x", "global x\nx = value\nglobal x", "[(x := item) for item in items]\nglobal x",
    "K = value\nglobal K", "x\nnonlocal x", "x = value\nnonlocal x"
  ])("rejects incompatible declaration events: %s", body => {
    const source = `def outer():\n x = 1\n def f():\n${body.split("\n").map(line => `  ${line}`).join("\n")}`;
    expect(() => validateDeclarations(collectSymbols(parseModule(source)))).toThrow(SyntaxError);
  });

  it("rejects parameter conflicts and module nonlocal declarations", () => {
    for (const source of ["def f(x): global x", "def f(x): nonlocal x", "nonlocal x", "if condition: nonlocal x"]) {
      expect(() => validateDeclarations(collectSymbols(parseModule(source)))).toThrow(SyntaxError);
    }
  });

  it("reports declaration positions and filenames", () => {
    try {
      validateDeclarations(collectSymbols(parseModule("x = 1\nglobal x")), "declarations.py");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ filename: "declarations.py", position: { line: 2, column: 7 } });
    }
  });
});
