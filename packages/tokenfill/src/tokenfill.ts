import type { TiktokenEncoding } from "tiktoken";
import { BUILT_IN_CORPUS_ARTICLES, CORPUS_ARTICLE_SEPARATOR } from "./corpus.js";
import { createTokenizer } from "./tokenizer.js";

export interface TokenfillOptions {
  encoding?: TiktokenEncoding;
}

export interface TokenfillResult {
  text: string;
  actualTokens: number;
}

const builtInCorpusText = BUILT_IN_CORPUS_ARTICLES.join(CORPUS_ARTICLE_SEPARATOR);
const corpusTokensByEncoding = new Map<TiktokenEncoding, Uint32Array>();

function getCorpusTokens(encoding: TiktokenEncoding, encode: (text: string) => Uint32Array): Uint32Array {
  const cachedTokens = corpusTokensByEncoding.get(encoding);

  if (cachedTokens) {
    return cachedTokens;
  }

  const encodedCorpus = encode(builtInCorpusText);
  corpusTokensByEncoding.set(encoding, encodedCorpus);
  return encodedCorpus;
}

export function tokenfill(tokenCount: number, options: TokenfillOptions = {}): TokenfillResult {
  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new TypeError(`tokenCount must be a non-negative integer, received ${tokenCount}`);
  }

  const tokenizer = createTokenizer({ encoding: options.encoding });

  try {
    const corpusTokens = getCorpusTokens(tokenizer.encoding, tokenizer.encode);
    const maxCorpusTokens = corpusTokens.length;

    if (tokenCount > maxCorpusTokens) {
      throw new Error(
        `Requested token count ${tokenCount} exceeds built-in corpus size ${maxCorpusTokens} for encoding ${tokenizer.encoding}`
      );
    }

    const text = tokenizer.decode(corpusTokens.slice(0, tokenCount));

    return {
      text,
      actualTokens: tokenCount
    };
  } finally {
    tokenizer.free();
  }
}
