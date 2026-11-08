import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CORPUS_ARTICLE_SEPARATOR = "\n\n";

const corpusDirectoryPath = join(dirname(fileURLToPath(import.meta.url)), "corpus");

function getCorpusFileNames(): string[] {
  return readdirSync(corpusDirectoryPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function loadBuiltInCorpusArticles(): string[] {
  const corpusFileNames = getCorpusFileNames();

  if (corpusFileNames.length === 0) {
    throw new Error(`No built-in corpus markdown files found in ${corpusDirectoryPath}`);
  }

  return corpusFileNames.map(fileName => readFileSync(join(corpusDirectoryPath, fileName), "utf8").trim());
}

export const BUILT_IN_CORPUS_ARTICLES = loadBuiltInCorpusArticles();
