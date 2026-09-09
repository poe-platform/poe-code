import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("class definitions", () => {
  it("parses plain and empty-argument class suites", () => {
    expect(parseModule("class A: pass\nclass B(): pass"))
      .toMatchObject({ body: [{ kind: "class", name: { name: "A" }, arguments: [], decorators: [], body: [{ kind: "pass" }] },
        { kind: "class", name: { name: "B" }, arguments: [] }] });
  });

  it("preserves ordered bases, unpacking, and metaclass keywords", () => {
    expect(parseModule("class C(Base, *bases, metaclass=Meta, **options): pass"))
      .toMatchObject({ body: [{ arguments: [
        { kind: "positional", value: { name: "Base" } }, { kind: "starred", value: { name: "bases" } },
        { kind: "keyword", name: "metaclass", value: { name: "Meta" } }, { kind: "mapping", value: { name: "options" } }
      ] }] });
  });

  it("parses decorated normalized class names and nested methods", () => {
    expect(parseModule("@first\n@saved := second\nclass K:\n @method\n async def f(self): return await work()\n class Inner: pass\nafter()"))
      .toMatchObject({ body: [{ kind: "class", name: { name: "K", spelling: "K" },
        decorators: [{ name: "first" }, { kind: "assignment-expression" }],
        body: [{ kind: "function", async: true }, { kind: "class" }] }, { kind: "expression-statement" }] });
  });

  it("accepts generator and named-expression base arguments", () => {
    expect(parseModule("class C((x for x in xs)): pass\nclass D(base := Base): pass"))
      .toMatchObject({ body: [{ arguments: [{ value: { kind: "comprehension", collection: "generator" } }] },
        { arguments: [{ value: { kind: "assignment-expression" } }] }] });
  });

  it("validates decorators, base arguments, and class bodies", () => {
    const bad = "[(x:=1) for x in xs]";
    for (const source of [`@${bad}\nclass C: pass`, `class C(${bad}): pass`, `class C: ${bad}`]) {
      expect(() => parseModule(source)).toThrow(SyntaxError);
    }
  });

  it.each(["class C:", "class if: pass", "class __debug__: pass", "class C(Base, metaclass=M, Base2): pass",
    "class C(**opts,*bases): pass", "class C(K=M,K=N): pass", "class C(__debug__=M): pass", "class C -> T: pass",
    "class C: class D: pass", "async class C: pass", "@dec\nasync class C: pass", "class C(x for x in xs,): pass", "class C(x for x in xs): pass"])
    ("rejects invalid class %s", source => { expect(() => parseModule(source)).toThrow(SyntaxError); });
});
