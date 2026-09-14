import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { collectSymbols } from "./symbol-collection.js";

describe("lexical symbol collection", () => {
  it("records child entry positions after outer inputs and before result stores",()=>{
    const root=collectSymbols(parseModule("r=[x for x in [y for y in ys]]\ns=lambda a=[z for z in zs]:a"));
    expect(root.events.map(event=>event.name)).toEqual(["ys","r","zs","s"]);
    expect(root.children.map(child=>child.parentEventIndex)).toEqual([1,1,3,3]);
    expect(root.children.map(child=>child.kind)).toEqual(["comprehension","comprehension","comprehension","lambda"]);
  });
  it("distinguishes binding targets from attribute and subscript reads", () => {
    const scope = collectSymbols(parseModule("x, *rest = source\nobj.attr = x\nitems[index] = rest\ndel gone"));
    expect(scope.events.map(e => [e.kind,e.name])).toEqual([
      ["read","source"],["write","x"],["write","rest"],["read","x"],["read","obj"],
      ["read","rest"],["read","items"],["read","index"],["delete","gone"]
    ]);
  });

  it("puts defaults and decorators outside nested function scopes", () => {
    const root = collectSymbols(parseModule("@decorate\ndef f(x=default):\n global g\n nonlocal n\n local = x\n return external"));
    expect(root.events.map(e => e.name)).toEqual(["decorate","default","f"]);
    expect(root.children[0]).toMatchObject({ kind: "function", events: [
      { kind: "parameter", name: "x" }, { kind: "global", name: "g" }, { kind: "nonlocal", name: "n" },
      { kind: "read", name: "x" }, { kind: "write", name: "local" }, { kind: "read", name: "external" }
    ] });
  });

  it("keeps class, lambda, and comprehension scopes separate", () => {
    const root = collectSymbols(parseModule("class C(Base):\n method = lambda arg=default: arg\nvalues = [(saved := x) for x in source]"));
    expect(root.children.map(s => s.kind)).toEqual(["class","comprehension"]);
    expect(root.children[0].children[0]).toMatchObject({ kind: "lambda", events: [{ kind: "parameter", name: "arg" }, { kind: "read", name: "arg" }] });
    expect(root.events).toContainEqual(expect.objectContaining({ kind: "write", name: "saved" }));
    expect(root.events).toContainEqual(expect.objectContaining({ kind: "read", name: "source" }));
    expect(root.children[1].events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "write", name: "x" }), expect.objectContaining({ kind: "write-outer", name: "saved" })
    ]));
  });

  it("collects imports, handlers, with targets, loop targets, and pattern captures", () => {
    const root = collectSymbols(parseModule("import a.b\nfrom c import d as e\ntry: pass\nexcept Error as err: pass\nwith cm as resource: pass\nfor item in items: pass\nmatch value:\n case Point(x, y=y): pass"));
    expect(root.events.filter(e => e.kind === "write" || e.kind === "import").map(e => e.name)).toEqual(["a","e","err","resource","item","x","y"]);
  });

  it("ignores type expressions and preserves annotation-only binding semantics", () => {
    const root = collectSymbols(parseModule("x: Missing\n(y): Missing\nobj.attr: Missing\ntype Alias = Missing\ndef f[T](x: Missing) -> Missing: pass"));
    expect(root.events.map(e => [e.kind,e.name])).toEqual([["annotation","x"],["read","obj"],["write","Alias"],["write","f"]]);
    expect(root.children[0].events.map(e => e.name)).toEqual(["x"]);
  });
});
