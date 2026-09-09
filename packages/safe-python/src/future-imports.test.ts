import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";
import { validateFutureImports } from "./future-imports.js";

describe("future directives", () => {
  it("accepts a leading docstring, aliases, and consecutive directives", () => {
    const module = parseModule("'doc'; from __future__ import annotations as a\nfrom __future__ import division, generator_stop\nx=1");
    expect([...validateFutureImports(module)]).toEqual(["annotations","division","generator_stop"]);
  });

  it.each(["nested_scopes","generators","division","absolute_import","with_statement","print_function","unicode_literals","barry_as_FLUFL","generator_stop","annotations"])
    ("recognizes %s", feature => { expect(validateFutureImports(parseModule(`from __future__ import ${feature}`)).has(feature)).toBe(true); });

  it.each(["pass\nfrom __future__ import annotations", "'doc'\n'other'\nfrom __future__ import annotations",
    "def f():\n from __future__ import annotations", "if x: from __future__ import annotations",
    "class C: from __future__ import annotations", "from __future__ import unknown", "from __future__ import braces", "from __future__ import *"])
    ("rejects misplaced or unknown directives: %s", source => { expect(()=>validateFutureImports(parseModule(source))).toThrow(SyntaxError); });

  it("does not treat relative imports or dotted module paths as directives", () => {
    expect([...validateFutureImports(parseModule("pass\nfrom .__future__ import unknown\nfrom __future__.sub import unknown"))]).toEqual([]);
  });

  it("enables Barry comparisons in nested expressions and normalizes their AST operator", () => {
    const module = parseModule("from __future__ import barry_as_FLUFL as b\ndef f(): return x <> y\nz=f'{x <> y}'");
    expect(module.body[1]).toMatchObject({ body: [{ value: { kind: "comparison", operators: ["!="] } }] });
    expect(()=>parseModule("from __future__ import barry_as_FLUFL\nx != y")).toThrow(SyntaxError);
    expect(()=>parseModule("x <> y")).toThrow(SyntaxError);
    expect(()=>parseModule("from __future__ import barry_as_FLUFL\nx < > y")).toThrow(SyntaxError);
  });
});
