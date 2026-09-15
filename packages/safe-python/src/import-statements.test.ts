import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("import statement syntax", () => {
  it("retains dotted module paths and aliases without loading modules", () => {
    expect(parseModule("import nonexistent.child as local, other")).toMatchObject({ body: [{ kind: "import", imports: [
      { path: [{ name: "nonexistent" }, { name: "child" }], alias: { name: "local" } },
      { path: [{ name: "other" }], alias: null }
    ] }] });
  });

  it("parses relative levels, optional module names, and imported aliases", () => {
    expect(parseModule("from ...pkg.child import value as local, other")).toMatchObject({ body: [{ kind: "import-from", level: 3,
      module: [{ name: "pkg" }, { name: "child" }], imports: [{ path: [{ name: "value" }], alias: { name: "local" } }, { path: [{ name: "other" }] }]
    }] });
    expect(parseModule("from .... import *")).toMatchObject({ body: [{ kind: "import-from", level: 4, module: [], imports: "*" }] });
  });

  it("accepts parenthesized multiline lists and their trailing comma", () => {
    expect(parseModule("from pkg import (\n a, # comment\n b as c,\n)\n")).toMatchObject({ body: [{ imports: [
      { path: [{ name: "a" }], alias: null }, { path: [{ name: "b" }], alias: { name: "c" } }
    ] }] });
  });

  it("normalizes each path and alias component while retaining spelling", () => {
    expect(parseModule("import ｐｋｇ.𝒙 as K")).toMatchObject({ body: [{ imports: [{ path: [{ name: "pkg", spelling: "ｐｋｇ" }, { name: "x", spelling: "𝒙" }], alias: { name: "K", spelling: "K" } }] }] });
    expect(() => parseModule("import ｉｆ as name; from pkg import ｉｆ")).not.toThrow();
  });

  it("checks the bound name, not every path component, for __debug__", () => {
    expect(() => parseModule("import pkg.__debug__; import __debug__ as name; from __debug__ import x; from pkg import __debug__ as name")).not.toThrow();
  });

  it.each(["import", "import x,", "import x as", "import .x", "import (x)", "import *", "import if", "from import x", "from pkg import", "from pkg import x,", "from pkg import x.y", "from pkg import ()", "from pkg import (*)", "from pkg import *, x", "from pkg import x as y.z", "from .pkg. import x", "import __debug__", "import __debug__.x", "import x as __ｄebug__", "from pkg import __debug__", "from pkg import x as __debug__"])
    ("rejects malformed import %s", text => { expect(() => parseModule(text)).toThrow(SyntaxError); });
});
