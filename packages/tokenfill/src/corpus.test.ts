import { describe, expect, it } from "vitest";
import { BUILT_IN_CORPUS_ARTICLES, CORPUS_ARTICLE_SEPARATOR } from "./corpus.js";

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
