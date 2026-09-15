import { describe, expect, it } from "vitest";
import { parseModule } from "./module.js";

describe("control-flow simple statement syntax", () => {
  it("parses bare and valued returns, with tuple unpacking", () => {
    expect(parseModule("return; return x; return a, *b,")).toMatchObject({ body: [
      { kind: "return", value: null }, { kind: "return", value: { name: "x" } },
      { kind: "return", value: { kind: "tuple", items: [{ name: "a" }, { kind: "unpack" }] } }
    ] });
  });

  it("retains bare raise, exception expressions, and explicit causes", () => {
    expect(parseModule("raise; raise Error(); raise error from None")).toMatchObject({ body: [
      { kind: "raise", exception: null, cause: null },
      { kind: "raise", exception: { kind: "call" }, cause: null },
      { kind: "raise", exception: { name: "error" }, cause: { literalKind: "none" } }
    ] });
  });

  it("parses assertions with optional message expressions", () => {
    expect(parseModule("assert x; assert x > 0, message()")).toMatchObject({ body: [
      { kind: "assert", condition: { name: "x" }, message: null },
      { kind: "assert", condition: { kind: "comparison" }, message: { kind: "call" } }
    ] });
    expect(parseModule("assert (x,y)")).toMatchObject({ body: [{ condition: { kind: "tuple" } }] });
  });

  it("keeps loop transfers as distinct statements", () => {
    expect(parseModule("break; continue; pass")).toMatchObject({ body: [{ kind: "break" }, { kind: "continue" }, { kind: "pass" }] });
  });

  it("validates expressions in every new statement operand", () => {
    for (const text of ["return [(x:=1) for x in xs]", "raise [(x:=1) for x in xs]", "raise error from [(x:=1) for x in xs]", "assert [(x:=1) for x in xs]", "assert x, [(x:=1) for x in xs]"]) {
      expect(() => parseModule(text)).toThrow(SyntaxError);
    }
  });

  it.each(["return *x", "return yield x", "return x := 1", "raise from error", "raise x,y", "raise x from", "raise x from y from z", "raise x := 1", "assert", "assert x,", "assert x,y,z", "assert x := 1", "break x", "continue x"])
    ("rejects malformed statement %s", text => { expect(() => parseModule(text)).toThrow(SyntaxError); });
});
