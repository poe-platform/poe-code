import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { validateControlFlow } from "./control-flow-validation.js";

describe("statement context validation", () => {
  it.each([
    "def f(): return 1", "async def f(): return 1", "while x: break", "for x in xs: continue",
    "while x:\n for y in ys: pass\n else: break", "try: pass\nexcept* E:\n for x in xs: break",
    "def f():\n try: pass\n except* E:\n  def g(): return 1", "async def f():\n async for x in xs: pass\n async with cm: pass",
    "if condition:\n from mod import *", "class C:\n def f(self): return 1"
  ])("accepts valid statement contexts: %s", source => {
    expect(() => validateControlFlow(parseModule(source))).not.toThrow();
  });

  it.each([
    "return", "break", "continue", "class C: return", "while x:\n def f(): break", "while x:\n class C: continue",
    "while x: pass\nelse: break", "for x in xs: pass\nelse: continue", "def f():\n try: pass\n except* E: return",
    "for x in xs:\n try: pass\n except* E: break", "for x in xs:\n try: pass\n except* E: continue",
    "def f(): from mod import *", "class C: from mod import *", "async for x in xs: pass", "async with cm: pass",
    "async def f():\n def g():\n  async with cm: pass", "async def f():\n class C:\n  async for x in xs: pass"
  ])("rejects invalid statement contexts: %s", source => {
    expect(() => validateControlFlow(parseModule(source))).toThrow(SyntaxError);
  });

  it("reports the offending statement position and caller filename", () => {
    try {
      validateControlFlow(parseModule("if x:\n return"), "sample.py");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ name: "SyntaxError", filename: "sample.py", position: { line: 2, column: 1 } });
    }
  });
});
