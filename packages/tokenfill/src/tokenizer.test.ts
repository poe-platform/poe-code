import { describe, expect, it } from "vitest";
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
    expect(tokens.length).toBe(2);
    expect(tokenizer.decode(tokens)).toBe(text);
  });

  it.each([
    ["hello", 1],
    ["hello world", 2],
    ["The quick brown fox jumps over the lazy dog.", 10],
    ["今天天气很好，我们去公园散步吧。", 20]
  ])("counts tokens accurately for %s", (text, expectedCount) => {
    const tokenizer = createTokenizer();

    expect(tokenizer.count(text)).toBe(expectedCount);
  });

  it("supports switching encoding via option", () => {
    const text = "今天天气很好，我们去公园散步吧。";
    const defaultTokenizer = createTokenizer();
    const o200kTokenizer = createTokenizer({ encoding: "o200k_base" });

    expect(defaultTokenizer.count(text)).toBe(20);
    expect(o200kTokenizer.count(text)).toBe(12);
  });

  it("truncates to an exact token count", () => {
    const tokenizer = createTokenizer();
    const text = "The quick brown fox jumps over the lazy dog.";
    const truncated = tokenizer.truncate(text, 5);

    expect(tokenizer.count(truncated)).toBe(5);
  });
});
