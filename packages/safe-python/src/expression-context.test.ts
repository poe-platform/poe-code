import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { validateControlFlow } from "./control-flow-validation.js";

describe("expression placement validation", () => {
  it.each([
    "def f(): yield 1", "def f(): yield from xs", "async def f(): await work()", "async def f():\n yield 1\n return",
    "lambda: (yield 1)", "(await f() for x in xs)", "(x async for x in xs)", "([await f() for y in ys] for x in xs)",
    "async def f(): return [x async for x in xs]", "def f():\n def g(x=(yield 1)): pass",
    "async def f():\n x = lambda a=await work(): a", "def f():\n class C((yield 1)): pass",
    "async def f():\n def g(): yield 1\n return 1", "async def f():\n x = lambda: (yield 1)\n return 1"
  ])("accepts valid expression scopes: %s", source => {
    expect(() => validateControlFlow(parseModule(source))).not.toThrow();
  });

  it.each([
    "yield 1", "yield from xs", "await work()", "class C: yield 1", "class C: await work()",
    "def f(): await work()", "async def f(): yield from xs", "async def f():\n return 1\n yield 2",
    "async def f():\n def g(x=(yield 1)): pass\n return 1", "async def f():\n x = lambda: await work()",
    "[await f() for x in xs]", "[x async for x in xs]", "(x for x in await xs)",
    "def f(): return [x async for x in xs]", "async def f():\n class C:\n  x = [await f() for x in xs]",
    "def f(x=(yield 1)): pass", "@await work()\ndef f(): pass"
  ])("rejects invalid expression scopes: %s", source => {
    expect(() => validateControlFlow(parseModule(source))).toThrow(SyntaxError);
  });
});
