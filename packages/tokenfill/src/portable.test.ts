import { expect, it, vi } from "vitest";

vi.mock("./corpus.js", () => ({
  BUILT_IN_CORPUS_ARTICLES: ["é🌍"],
  CORPUS_ARTICLE_SEPARATOR: "\n\n"
}));
vi.mock("./tokenizer.js", () => ({
  createTokenizer: () => ({
    encoding: "cl100k_base",
    encode: (text: string) => Uint32Array.from([...text].map(char => char.codePointAt(0)!)),
    decode: (tokens: Uint32Array) => String.fromCodePoint(...tokens),
    free: () => {}
  })
}));

it("imports and fills tokens without Buffer while retaining UTF-8 corpus limits", async () => {
  vi.stubGlobal("Buffer", undefined);
  try {
    const { tokenfill } = await import("./tokenfill.js");
    expect(tokenfill(2)).toEqual({ text: "é🌍", actualTokens: 2 });
    expect(() => tokenfill(7)).toThrow("exceeds built-in corpus size 6");
  } finally {
    vi.unstubAllGlobals();
  }
});
