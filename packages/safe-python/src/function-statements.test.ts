import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("function definitions", () => {
  it("accepts named assignment decorators", () => {
    expect(parseModule("@saved := decorator\ndef f(): pass"))
      .toMatchObject({ body: [{ decorators: [{ kind: "assignment-expression", target: { name: "saved" } }] }] });
  });
  it("parses all parameter categories and retains executable defaults", () => {
    expect(parseModule("def f(a, b=1, /, c=2, *args, d, e=3, **kw): return a"))
      .toMatchObject({ body: [{ kind: "function", name: { name: "f" }, async: false, decorators: [], parameters: [
        { name: "a", kind: "positional-only", default: null }, { name: "b", kind: "positional-only", default: { value: 1n } },
        { name: "c", kind: "positional-or-keyword" }, { name: "args", kind: "var-positional" },
        { name: "d", kind: "keyword-only", default: null }, { name: "e", kind: "keyword-only" }, { name: "kw", kind: "var-keyword" }
      ], body: [{ kind: "return" }] }] });
  });

  it("parses and retains annotations, including starred variadic annotations", () => {
    const module = parseModule("def f(x: unknown() = 1, *args: *tuple[int, ...], **kw: Missing) -> another(): pass");
    const fn = module.body[0];
    expect(fn.kind).toBe("function");
    expect(fn).toHaveProperty("returns");
    if (fn.kind === "function") {
      for (const parameter of fn.parameters) expect(parameter).toHaveProperty("annotation");
      expect(fn.parameters[0].default).toMatchObject({ value: 1n });
    }
  });

  it("retains decorators in source order and supports nested async definitions", () => {
    expect(parseModule("@first\n@factory(x)\nasync def K():\n def inner(): pass\n return await work()\nafter()"))
      .toMatchObject({ body: [{ kind: "function", async: true, name: { spelling: "K", name: "K" },
        decorators: [{ name: "first" }, { kind: "call" }], body: [{ kind: "function" }, { kind: "return" }] }, { kind: "expression-statement" }] });
  });

  it("validates decorators, defaults, bodies and annotations", () => {
    const bad = "[(x:=1) for x in xs]";
    for (const source of [`@${bad}\ndef f(): pass`, `def f(a=${bad}): pass`, `def f(): ${bad}`]) {
      expect(() => parseModule(source)).toThrow(SyntaxError);
    }
    expect(() => parseModule(`def f(a: ${bad}) -> ${bad}: pass`)).toThrow(SyntaxError);
  });

  it.each(["def f:", "def f():", "def if(): pass", "def __debug__(): pass", "def f(a,a): pass", "def f(K,K): pass",
    "def f(a=1,b): pass", "def f(*): pass", "def f(*,**kw): pass", "def f(*args=1): pass", "def f(**kw,x): pass",
    "def f(x:): pass", "def f(x: *T): pass", "def f() ->: pass", "@a; b\ndef f(): pass", "@a\npass",
    "def f(): def g(): pass", "async def f():\npass"])
    ("rejects invalid function %s", source => { expect(() => parseModule(source)).toThrow(SyntaxError); });
});
