import { describe, expect, it } from "vitest";
import { manglePrivateName } from "./private-names.js";
import { parseModule } from "./module.js";
import { collectSymbols } from "./symbol-collection.js";
import { resolveSymbols } from "./symbol-resolution.js";

describe("private name mangling", () => {
  it.each([
    ["__x", "C", "_C__x"], ["__x", "__C", "_C__x"], ["__x", "___", "__x"],
    ["__x__", "C", "__x__"], ["_x", "C", "_x"], ["__pkg.sub", "C", "__pkg.sub"],
    ["__x", null, "__x"], ["__x", "Κ", "_Κ__x"]
  ])("mangles %s in %s", (name, cls, expected) => { expect(manglePrivateName(name!, cls)).toBe(expected); });

  it("inherits class context in methods, lambdas, comprehensions, and nested functions", () => {
    const scope = collectSymbols(parseModule("class C:\n __value=1\n def __method(self,__arg):\n  def nested(): return __arg\n  return lambda: __value\n values=[__x for __x in __source]"));
    const cls=scope.children[0], method=cls.children[0];
    expect(cls.privateName).toBe("C");
    expect(cls.events.map(e=>e.name)).toEqual(["_C__value","_C__method","_C__source","values"]);
    expect(method.events).toContainEqual(expect.objectContaining({ kind: "parameter", name: "_C__arg" }));
    expect(method.children[0].events[0].name).toBe("_C__arg");
    expect(method.children[1].events[0].name).toBe("_C__value");
    expect(cls.children[1].events.map(e=>e.name)).toEqual(["_C__x","_C__x"]);
  });

  it("uses the outer class for nested headers and the nested class for its body", () => {
    const root=collectSymbols(parseModule("class Outer:\n @__decorator\n class __Inner(__Base):\n  __x=__value"));
    const outer=root.children[0], inner=outer.children[0];
    expect(outer.events.map(e=>e.name)).toEqual(["_Outer__decorator","_Outer__Base","_Outer__Inner"]);
    expect(inner.events.map(e=>e.name)).toEqual(["_Inner__value","_Inner__x"]);
  });

  it("mangles import bindings and resolves private parameter closures", () => {
    const scope=collectSymbols(parseModule("class C:\n import __pkg.sub\n from mod import __item\n def f(__arg):\n  return lambda: __arg"));
    expect(scope.children[0].events.map(e=>e.name)).toEqual(["_C__pkg","_C__item","f"]);
    const resolved=resolveSymbols(scope).children[0].children[0];
    expect(resolved.cells.has("_C__arg")).toBe(true);
  });

  it("rejects parameter collisions introduced by mangling", () => {
    for (const source of ["class C:\n def f(__x,_C__x): pass", "class C:\n f = lambda __x,_C__x: 1"]) {
      expect(()=>resolveSymbols(collectSymbols(parseModule(source)))).toThrow(SyntaxError);
    }
  });
});
