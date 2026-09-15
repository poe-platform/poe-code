import { describe, expect, it } from "vitest";
import { bindArguments, type CallParameter } from "./argument-binding.js";

interface Key { readonly text: string; readonly matches: boolean }
const names = { parameter: (key: Key) => key.matches ? key.text : undefined, display: (key: Key) => key.text };

describe("argument binding with original keyword objects", () => {
  it("matches source parameters while retaining original extra keys", () => {
    const a = { text: "a", matches: true }, extra = { text: "extra", matches: true };
    const signature: CallParameter[] = [{ name: "a", kind: "positional-or-keyword" }, { name: "kw", kind: "var-keyword" }];
    const bound = bindArguments("f", signature, [], new Map([[a, 1], [extra, 2]]), new Map(), undefined, names);
    expect(bound.values.get("a")).toBe(1); expect([...bound.varKeywords.keys()]).toEqual([extra]); expect(bound.varKeywords.get(extra)).toBe(2);
  });
  it("does not collapse distinct keys sharing a host string spelling", () => {
    const astral = { text: "𐀀", matches: true }, surrogatePair = { text: "𐀀", matches: false };
    const signature: CallParameter[] = [{ name: "𐀀", kind: "keyword-only" }, { name: "kw", kind: "var-keyword" }];
    const bound = bindArguments("f", signature, [], new Map([[surrogatePair, 1], [astral, 2]]), new Map(), undefined, names);
    expect(bound.values.get("𐀀")).toBe(2); expect(bound.varKeywords.get(surrogatePair)).toBe(1); expect(bound.varKeywords.size).toBe(1);
  });
  it("preserves positional-only conflict precedence and declaration order", () => {
    const signature: CallParameter[] = [{ name: "a", kind: "positional-only" }, { name: "b", kind: "positional-only" }];
    const keywords = new Map([[{ text: "other", matches: true }, 0], [{ text: "b", matches: true }, 2], [{ text: "a", matches: true }, 1]]);
    expect(() => bindArguments("f", signature, [], keywords, new Map(), undefined, names)).toThrow("f() got some positional-only arguments passed as keyword arguments: 'a, b'");
  });
  it("reports duplicates and unexpected keywords using their source spelling", () => {
    const signature: CallParameter[] = [{ name: "a", kind: "positional-or-keyword" }];
    expect(() => bindArguments("f", signature, [1], new Map([[{ text: "a", matches: true }, 2]]), new Map(), undefined, names)).toThrow("multiple values for argument 'a'");
    expect(() => bindArguments("f", signature, [1], new Map([[{ text: "extra", matches: false }, 2]]), new Map(), undefined, names)).toThrow("unexpected keyword argument 'extra'");
  });
});
