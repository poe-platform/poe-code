import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("scope declarations and deletion syntax", () => {
  it("retains normalized declaration names, spelling, duplicates, and order", () => {
    expect(parseModule("global 𝒙, x, K; nonlocal e\u0301, outer")).toMatchObject({ body: [
      { kind: "global", names: [{ name: "x", spelling: "𝒙" }, { name: "x", spelling: "x" }, { name: "K", spelling: "K" }] },
      { kind: "nonlocal", names: [{ name: "é", spelling: "e\u0301" }, { name: "outer" }] }
    ] });
    expect(() => parseModule("global __debug__, ｉｆ")).not.toThrow();
  });

  it("parses deletion targets without flattening explicit destructuring", () => {
    expect(parseModule("del a, (b,c), [obj.x, data[1:]],")).toMatchObject({ body: [{ kind: "delete", targets: [
      { kind: "name", name: "a" }, { kind: "tuple", items: [{ name: "b" }, { name: "c" }] },
      { kind: "list", items: [{ kind: "attribute" }, { kind: "subscript" }] }
    ] }] });
    expect(parseModule("del (), []")).toMatchObject({ body: [{ targets: [{ kind: "tuple", items: [] }, { kind: "list", items: [] }] }] });
    expect(parseModule("del f().x, (a+b)[0]")).toMatchObject({ body: [{ targets: [{ kind: "attribute" }, { kind: "subscript" }] }] });
  });

  it("visits executable target expressions for scope checks", () => {
    expect(() => parseModule("del obj[[(x:=1) for x in xs]]")).toThrow(SyntaxError);
  });

  it.each(["global", "nonlocal", "global x,", "nonlocal x,", "global x.y", "nonlocal (x)", "global True", "global x=1",
    "del", "del *x", "del [x,*y]", "del a,(*b,)", "del f()", "del 1", "del x+y", "del {x}", "del __debug__", "del obj.__ｄebug__", "del x = 1"])
    ("rejects invalid declaration/deletion %s", text => { expect(() => parseModule(text)).toThrow(SyntaxError); });
});
