import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tokenfill } from "./tokenfill.js";
import { createTokenizer } from "./tokenizer.js";
import { BUILT_IN_CORPUS_ARTICLES, CORPUS_ARTICLE_SEPARATOR } from "./corpus.js";

function getCorpusText(): string {
  return BUILT_IN_CORPUS_ARTICLES.join(CORPUS_ARTICLE_SEPARATOR);
}

describe("tokenfill", () => {
  const tokenizer = createTokenizer();
  let corpusTokens = new Uint32Array();
  let corpusTokenCount = 0;

  beforeAll(() => {
    corpusTokens = tokenizer.encode(getCorpusText());
    corpusTokenCount = corpusTokens.length;
  });

  afterAll(() => {
    tokenizer.free();
  });

  it("returns text and exact actualTokens for requested count", () => {
    const result = tokenfill(25);

    expect(result.actualTokens).toBe(25);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("concatenates built-in articles sequentially", () => {
    const requestedTokens = 40;

    const result = tokenfill(requestedTokens);
    const resultTokens = tokenizer.encode(result.text);

    expect(Array.from(resultTokens)).toEqual(Array.from(corpusTokens.slice(0, requestedTokens)));
  });

  it("truncates at the exact token boundary in the last article", () => {
    const requestedTokens = corpusTokenCount - 3;

    const result = tokenfill(requestedTokens);
    const expectedText = tokenizer.decode(corpusTokens.slice(0, requestedTokens));

    expect(result.text).toBe(expectedText);
    expect(result.actualTokens).toBe(requestedTokens);
  });

  it("throws when token request exceeds corpus size", () => {
    expect(() => tokenfill(corpusTokenCount + 1)).toThrow(/exceeds built-in corpus size/i);
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

  it("supports optional tokenizer encoding", () => {
    const optionalTokenizer = createTokenizer({ encoding: "o200k_base" });
    const smaller = tokenfill(20, { encoding: "o200k_base" });
    const larger = tokenfill(40, { encoding: "o200k_base" });

    expect(smaller.actualTokens).toBe(20);
    expect(optionalTokenizer.count(smaller.text)).toBe(20);
    expect(larger.text.startsWith(smaller.text)).toBe(true);

    optionalTokenizer.free();
  });
});
