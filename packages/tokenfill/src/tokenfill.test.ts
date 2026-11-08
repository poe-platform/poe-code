import { describe, expect, it, vi } from "vitest";

vi.mock("./corpus.js", () => ({
  BUILT_IN_CORPUS_ARTICLES: [
    "# Mock Article\n\nThe quick brown fox jumps over the lazy dog. ".repeat(5)
  ],
  CORPUS_ARTICLE_SEPARATOR: "\n\n"
}));

vi.mock("./tokenizer.js", () => ({
  createTokenizer: (options?: { encoding?: string }) => ({
    encoding: options?.encoding ?? "cl100k_base",
    encode: (text: string): Uint32Array =>
      Uint32Array.from([...text].map((ch) => ch.codePointAt(0)!)),
    decode: (tokens: Uint32Array | number[]): string => {
      const arr = tokens instanceof Uint32Array ? tokens : Uint32Array.from(tokens);
      return String.fromCodePoint(...arr);
    },
    count: (text: string): number => [...text].length,
    truncate: (text: string, count: number): string =>
      [...text].length <= count ? text : [...text].slice(0, count).join(""),
    free: () => {}
  })
}));

import { tokenfill } from "./tokenfill.js";

describe("tokenfill", () => {
  it("returns text and exact actualTokens for requested count", () => {
    const result = tokenfill(25);

    expect(result.actualTokens).toBe(25);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("throws when token count is not a non-negative integer", () => {
    expect(() => tokenfill(-1)).toThrow(/non-negative integer/i);
    expect(() => tokenfill(1.5)).toThrow(/non-negative integer/i);
  });

  it("is deterministic for repeated calls", () => {
    const first = tokenfill(55);
    const second = tokenfill(55);

    expect(first).toEqual(second);
  });

  it("returns smaller token counts as prefixes of larger ones", () => {
    const smaller = tokenfill(30);
    const larger = tokenfill(70);

    expect(larger.text.startsWith(smaller.text)).toBe(true);
  });

  it("throws when token request exceeds corpus size", () => {
    expect(() => tokenfill(Number.MAX_SAFE_INTEGER)).toThrow(/exceeds built-in corpus size/i);
  });

  it("accepts an explicit encoding option", () => {
    const implicit = tokenfill(20);
    const explicit = tokenfill(20, { encoding: "cl100k_base" });

    expect(explicit).toEqual(implicit);
  });
});
