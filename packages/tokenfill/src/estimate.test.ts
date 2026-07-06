import { describe, expect, it } from "vitest";
import { countTokens } from "./tokenizer.js";
import { estimateTokens, EXACT_COUNT_CHAR_LIMIT } from "./estimate.js";

describe("estimateTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("matches countTokens exactly for short text", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    expect(estimateTokens(text)).toBe(countTokens(text));
  });

  it("matches countTokens exactly up to the exact-count limit", () => {
    const text = "word".repeat(EXACT_COUNT_CHAR_LIMIT / 4);
    expect(text.length).toBe(EXACT_COUNT_CHAR_LIMIT);
    expect(estimateTokens(text)).toBe(countTokens(text));
  });

  it("stays within 15% of the exact count for large prose", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(20_000);
    const exact = countTokens(text);
    const estimate = estimateTokens(text);
    expect(Math.abs(estimate - exact) / exact).toBeLessThan(0.15);
  });

  it("stays within 15% of the exact count for large JSON-like text", () => {
    const text = JSON.stringify(
      Array.from({ length: 5_000 }, (_, index) => ({
        id: `item-${index}`,
        path: `/very/long/path/segment/${index}/file.ts`,
        ok: index % 2 === 0
      }))
    );
    const exact = countTokens(text);
    const estimate = estimateTokens(text);
    expect(Math.abs(estimate - exact) / exact).toBeLessThan(0.15);
  });

  it("is deterministic", () => {
    const text = "abc def ghi ".repeat(10_000);
    expect(estimateTokens(text)).toBe(estimateTokens(text));
  });

  it("does not throw when sample boundaries split surrogate pairs", () => {
    const emoji = "😀".repeat(EXACT_COUNT_CHAR_LIMIT);
    expect(estimateTokens(emoji)).toBeGreaterThan(0);
  });
});
