import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { collectSymbols } from "./symbol-collection.js";
import { resolveSymbols } from "./symbol-resolution.js";

describe("implicit class cells", () => {
  it.each(["return __class__", "return super()", "nonlocal __class__\nreturn __class__"])
    ("captures the class cell for %s", body => {
      const root = resolveSymbols(collectSymbols(parseModule(`class C:\n def f(self):\n${body.split("\n").map(line=>`  ${line}`).join("\n")}`)));
      const cls = root.children[0], method = cls.children[0];
      expect(cls.cells.has("__class__")).toBe(true);
      expect(method.bindings.get("__class__")).toEqual({ kind: "free", owner: cls.scope });
    });

  it("does not confuse a class namespace value with the implicit cell", () => {
    for (const statement of ["__class__=1", "global __class__"]) {
      const cls = resolveSymbols(collectSymbols(parseModule(`class C:\n ${statement}\n def f(self): return __class__`))).children[0];
      expect(cls.children[0].bindings.get("__class__")).toEqual({ kind: "free", owner: cls.scope });
    }
  });

  it("forwards class cells through nested callables and into nested class bodies", () => {
    const cls = resolveSymbols(collectSymbols(parseModule("class C:\n def f(self):\n  return lambda: __class__\n class D:\n  x=__class__"))).children[0];
    expect(cls.children[0].free.get("__class__")).toBe(cls.scope);
    expect(cls.children[0].children[0].bindings.get("__class__")).toEqual({ kind: "free", owner: cls.scope });
    expect(cls.children[1].bindings.get("__class__")).toEqual({ kind: "free", owner: cls.scope });
  });

  it("keeps module/class-body loads and augmented stores from triggering implicit reads", () => {
    const root = resolveSymbols(collectSymbols(parseModule("super\nclass C:\n x=super\n def f(self): super += 1")));
    expect(root.cells.size).toBe(0);
    expect(root.children[0].cells.has("__class__")).toBe(false);
    expect(root.children[0].children[0].bindings.has("__class__")).toBe(false);
  });

  it("records implicit reads distinctly and checks subsequent declarations", () => {
    const root = collectSymbols(parseModule("class C:\n def f(self): return super"));
    expect(root.children[0].children[0].events).toContainEqual(expect.objectContaining({ kind: "implicit-read", name: "__class__" }));
    expect(()=>resolveSymbols(collectSymbols(parseModule("def f():\n super\n global __class__")))).toThrow(SyntaxError);
  });

  it("respects ordinary function bindings and explicit global barriers", () => {
    for (const body of ["global __class__\nreturn __class__", "__class__=1\nreturn __class__"]) {
      const cls = resolveSymbols(collectSymbols(parseModule(`class C:\n def f(self):\n${body.split("\n").map(line=>`  ${line}`).join("\n")}`))).children[0];
      expect(cls.cells.has("__class__")).toBe(false);
    }
  });
});
