import { describe, expect, it } from "vitest";
import { analyzeModule } from "./analysis.js";

function names(source: string): string[] { return [...analyzeModule(source).qualifiedNames.values()]; }

describe("compiled lexical qualified names", () => {
  it("retains class paths and inserts locals only after functions", () => {
    expect(names("class A:\n def f(self):\n  class B:\n   def g(self): pass")).toEqual(["<module>", "A", "A.f", "A.f.<locals>.B", "A.f.<locals>.B.g"]);
  });

  it("does not use private-mangled names in displayed paths", () => {
    expect(names("class __C:\n def __f(self):\n  class __D: pass")).toEqual(["<module>", "__C", "__C.__f", "__C.__f.<locals>.__D"]);
  });

  it("normalizes source identifiers", () => {
    expect(names("class K:\n def K(self): pass")).toEqual(["<module>", "K", "K.K"]);
  });

  it.each(["def f():", "class f:"])("resets paths for explicit global definitions: %s", definition => {
    expect(names(`def outer():\n global f\n ${definition}\n  class C: pass`)).toEqual(["<module>", "outer", "f", "f.<locals>.C"].map(name => definition === "class f:" ? name.replace("f.<locals>.", "f.") : name));
  });

  it("uses mangled parent declarations to detect explicitly global definitions", () => {
    expect(names("class C:\n global __f\n def __f(): pass")).toEqual(["<module>", "C", "__f"]);
  });

  it("keeps lexical paths for nonlocal definitions", () => {
    expect(names("def outer():\n f=0\n def inner():\n  nonlocal f\n  def f(): pass")).toEqual(["<module>", "outer", "outer.<locals>.inner", "outer.<locals>.inner.<locals>.f"]);
  });

  it("places defaults outside function and lambda bodies", () => {
    expect(names("def f(x=lambda: (lambda: 1)):\n pass")).toEqual(["<module>", "<lambda>", "<lambda>.<locals>.<lambda>", "f"]);
  });

  it("skips inlined list/set/dict comprehension scopes", () => {
    for (const expression of ["[(lambda: 1) for x in []]", "{(lambda: 1) for x in []}", "{x:(lambda: 1) for x in []}"]) {
      expect(names(`def f():\n return ${expression}`)).toEqual(["<module>", "f", "f.<locals>.<lambda>"]);
    }
  });

  it("retains generator expression scope without a locals component after it", () => {
    expect(names("def f():\n return ((lambda: 1) for x in [])")).toEqual(["<module>", "f", "f.<locals>.<genexpr>", "f.<locals>.<genexpr>.<lambda>"]);
  });

  it("keeps comprehension outermost iterables in the containing code scope", () => {
    expect(names("class C:\n x=[(lambda: 1) for x in ((lambda: 2) for y in [])]")).toEqual(["<module>", "C", "C.<genexpr>", "C.<genexpr>.<lambda>", "C.<lambda>"]);
  });

  it("keys metadata by the exact analyzed scope identity", () => {
    const result = analyzeModule("def f(): pass\ndef f(): pass");
    expect(result.qualifiedNames.get(result.scopes.scope)).toBe("<module>");
    expect(result.qualifiedNames.get(result.scopes.children[0].scope)).toBe("f");
    expect(result.qualifiedNames.get(result.scopes.children[1].scope)).toBe("f");
    expect(result.qualifiedNames.size).toBe(3);
  });
});
