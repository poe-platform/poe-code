import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { collectSymbols } from "./symbol-collection.js";
import { resolveSymbols } from "./symbol-resolution.js";

describe("lexical binding resolution", () => {
  it("promotes inlined locals to owners of already-free nested references",()=>{
    const root=resolveSymbols(collectSymbols(parseModule("def outer(x):\n def f():\n  keep=lambda:x\n  r=[x for x in [1]]\n  return keep\n return f")));
    const outer=root.children[0],fn=outer.children[0],lambda=fn.children[0];
    expect(lambda.bindings.get("x")).toEqual({kind:"free",owner:fn.scope});
    expect(fn.cells.has("x")).toBe(true);expect(fn.free.has("x")).toBe(false);expect(outer.cells.has("x")).toBe(false);
  });
  it.each(["seen=x\n  ","nonlocal x\n  ","[x for y in [1]]\n  "])("preserves an existing enclosing name before inline promotion: %s",before=>{
    const root=resolveSymbols(collectSymbols(parseModule("def outer(x):\n def f():\n  "+before+"keep=lambda:x\n  r=[x for x in [1]]\n  return keep\n return f")));
    const outer=root.children[0],fn=outer.children[0],lambda=fn.children.find(child=>child.scope.kind==="lambda")!;
    expect(lambda.bindings.get("x")).toEqual({kind:"free",owner:outer.scope});
  });
  it("does not convert initially global nested references into closures",()=>{
    const root=resolveSymbols(collectSymbols(parseModule("def f():\n keep=lambda:x\n r=[x for x in [1]]\n return keep"))),fn=root.children[0];
    expect(fn.children[0].bindings.get("x")).toEqual({kind:"global",owner:root.scope});
    expect(fn.cells.has("x")).toBe(false);
  });
  it("lets an earlier local inline occurrence precede a later free occurrence",()=>{
    const root=resolveSymbols(collectSymbols(parseModule("def outer(x):\n def f():\n  [x for x in [1]]\n  [x for y in [1]]\n  return lambda:x\n return f")));
    const fn=root.children[0].children[0];
    expect(fn.children[2].bindings.get("x")).toEqual({kind:"free",owner:fn.scope});
    expect(fn.children[1].bindings.get("x")).toEqual({kind:"free",owner:fn.scope});
  });
  it("does not make synthetic inline locals available to initial nonlocal validation",()=>{
    expect(()=>resolveSymbols(collectSymbols(parseModule("def f():\n [x for x in [1]]\n def g():nonlocal x")))).toThrow("no binding for nonlocal 'x' found");
  });
  it("resolves locals, implicit globals, and closures through intervening scopes", () => {
    const root = resolveSymbols(collectSymbols(parseModule("def outer(arg):\n x = arg\n def middle():\n  def inner(): return x + external\n  return inner\n return middle")));
    const outer = root.children[0], middle = outer.children[0], inner = middle.children[0];
    expect(outer.bindings.get("arg")).toMatchObject({ kind: "local" });
    expect(inner.bindings.get("x")).toEqual({ kind: "free", owner: outer.scope });
    expect(inner.bindings.get("external")).toEqual({ kind: "global", owner: root.scope });
    expect(outer.cells.has("x")).toBe(true);
    expect(middle.free.get("x")).toBe(outer.scope);
  });

  it("resolves nonlocal names even when the enclosing binding occurs later", () => {
    const root = resolveSymbols(collectSymbols(parseModule("def outer():\n def inner():\n  nonlocal x\n  x = 2\n x = 1")));
    expect(root.children[0].children[0].bindings.get("x")).toEqual({ kind: "free", owner: root.children[0].scope });
  });

  it("skips class bindings and class global declarations for method closures", () => {
    for (const middle of ["x = 2", "global x"]) {
      const root = resolveSymbols(collectSymbols(parseModule(`def outer():\n x=1\n class C:\n  ${middle}\n  def method(self):\n   nonlocal x\n   return x`)));
      const outer = root.children[0], cls = outer.children[0], method = cls.children[0];
      expect(method.bindings.get("x")).toEqual({ kind: "free", owner: outer.scope });
      expect(cls.free.get("x")).toBe(outer.scope);
    }
  });

  it("lets an intervening function global declaration block enclosing capture", () => {
    const root = resolveSymbols(collectSymbols(parseModule("def outer():\n x=1\n def middle():\n  global x\n  def inner(): return x")));
    expect(root.children[0].children[0].children[0].bindings.get("x")).toEqual({ kind: "global", owner: root.scope });
  });

  it("resolves comprehension captures and outward assignment expressions", () => {
    const root = resolveSymbols(collectSymbols(parseModule("def f():\n result = [(saved := x, lambda: x) for x in source]\n return saved")));
    const fn = root.children[0], comp = fn.children[0], lambda = comp.children[0];
    expect(comp.bindings.get("saved")).toEqual({ kind: "free", owner: fn.scope });
    expect(lambda.bindings.get("x")).toEqual({ kind: "free", owner: comp.scope });
    expect(comp.cells.has("x")).toBe(true);
    expect(fn.cells.has("saved")).toBe(true);
  });

  it.each([
    "def f(): nonlocal missing", "x=1\ndef f(): nonlocal x", "class C:\n x=1\n def f(): nonlocal x",
    "def outer():\n x=1\n def middle():\n  global x\n  def inner(): nonlocal x",
    "class C:\n values = [(saved:=x) for x in xs]"
  ])("rejects unavailable or forbidden enclosing bindings: %s", source => {
    expect(() => resolveSymbols(collectSymbols(parseModule(source)))).toThrow(SyntaxError);
  });
});
