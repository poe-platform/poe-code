import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("ignored generic type parameters", () => {
  it("parses constrained, bounded, variadic, and defaulted parameters", () => {
    for (const source of [
      "def f[T: Bound, U: (A,B), *Ts, **P](x: T) -> U: return x",
      "async def f[T=Default, *Ts=*tuple[A,B], **P=[A,B]](): pass",
      "class C[T: Bound = Default, *Ts = Tuple, **P = Params](Base): pass"
    ]) {
      const node = parseModule(source).body[0];
      expect(["function", "class"]).toContain(node.kind);
      expect(node).not.toHaveProperty("typeParameters");
    }
  });

  it("accepts trailing commas, multiline lists, and multiple variadic parameters", () => {
    expect(parseModule("@decorator\ndef f[\n *Ts, *Us, **P, **Q,\n](): pass\nclass C[T,]: pass"))
      .toMatchObject({ body: [{ kind: "function", decorators: [{ name: "decorator" }] }, { kind: "class" }] });
  });

  it("does not retain or validate type expressions as executable code", () => {
    const ignored = "[(x:=1) for x in xs]";
    expect(() => parseModule(`def f[T: ${ignored}, U = ${ignored}](): pass`)).not.toThrow();
    expect(() => parseModule(`class C[T = missing()]: pass`)).not.toThrow();
    expect(() => parseModule(`def f[T](x=${ignored}): pass`)).toThrow(SyntaxError);
    expect(() => parseModule(`class C[T](${ignored}): pass`)).toThrow(SyntaxError);
  });

  it.each(["", "T,T", "K,K", "__debug__", "if", "*", "**", "T=Default,U", "T=Default,*Ts",
    "*Ts=Default,**P", "*Ts: Bound", "**P: Bound", "T:", "T=", "T=*A", "**P=*A", "T,,U", "T U", "*Ts=*A if b else C"])
    ("rejects malformed generic parameter list %s", params => {
      expect(() => parseModule(`def f[${params}](): pass`)).toThrow(SyntaxError);
      expect(() => parseModule(`class C[${params}]: pass`)).toThrow(SyntaxError);
    });
});
