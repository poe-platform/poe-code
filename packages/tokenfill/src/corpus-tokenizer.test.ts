import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_CORPUS_ARTICLES, CORPUS_ARTICLE_SEPARATOR } from "./corpus.js";

// === tokenizer.test.ts ===

vi.mock("tiktoken", () => ({
  get_encoding: vi.fn((_encoding: string) => {
    const textEncoder = new TextEncoder();
    return {
      encode: (text: string): Uint32Array =>
        Uint32Array.from([...text].map((ch) => ch.codePointAt(0)!)),
      decode: (tokens: Uint32Array): Uint8Array =>
        textEncoder.encode(String.fromCodePoint(...tokens)),
      free: vi.fn()
    };
  })
}));

import { createTokenizer, DEFAULT_ENCODING } from "./tokenizer.js";

describe("tokenizer wrapper", () => {
  it("uses cl100k_base as default encoding", () => {
    const tokenizer = createTokenizer();

    expect(DEFAULT_ENCODING).toBe("cl100k_base");
    expect(tokenizer.encoding).toBe("cl100k_base");
  });

  it("wraps encode and decode for the configured encoding", () => {
    const tokenizer = createTokenizer({ encoding: "cl100k_base" });
    const text = "hello world";

    const tokens = tokenizer.encode(text);
    expect(tokens.length).toBe(11);
    expect(tokenizer.decode(tokens)).toBe(text);
  });

  it.each([
    ["hello", 5],
    ["hello world", 11],
    ["The quick brown fox jumps over the lazy dog.", 44],
    ["今天天气很好，我们去公园散步吧。", 16]
  ])("counts tokens accurately for %s", (text, expectedCount) => {
    const tokenizer = createTokenizer();

    expect(tokenizer.count(text)).toBe(expectedCount);
  });

  it("passes encoding option through to tiktoken", async () => {
    const { get_encoding } = await import("tiktoken");
    const o200kTokenizer = createTokenizer({ encoding: "o200k_base" });

    expect(o200kTokenizer.encoding).toBe("o200k_base");
    expect(get_encoding).toHaveBeenCalledWith("o200k_base");
  });

  it("truncates to an exact token count", () => {
    const tokenizer = createTokenizer();
    const text = "The quick brown fox jumps over the lazy dog.";
    const truncated = tokenizer.truncate(text, 5);

    expect(tokenizer.count(truncated)).toBe(5);
  });
});

// === corpus.test.ts ===

function getArticleTitle(article: string): string {
  const [firstLine = ""] = article.split("\n", 1);
  return firstLine.startsWith("# ") ? firstLine.slice(2).trim() : firstLine.trim();
}

describe("built-in corpus", () => {
  it("loads separate markdown articles", () => {
    expect(BUILT_IN_CORPUS_ARTICLES.length).toBeGreaterThan(40);

    for (const article of BUILT_IN_CORPUS_ARTICLES) {
      expect(article.startsWith("# ")).toBe(true);
      expect(article.length).toBeGreaterThan(1_000);
    }
  });

  it("contains distinct topics", () => {
    const titles = BUILT_IN_CORPUS_ARTICLES.map(getArticleTitle);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("has a large corpus payload", () => {
    const corpusText = BUILT_IN_CORPUS_ARTICLES.join(CORPUS_ARTICLE_SEPARATOR);

    expect(corpusText.length).toBeGreaterThanOrEqual(10_000_000);
    expect(corpusText.length).toBeLessThanOrEqual(14_000_000);
  });
});
