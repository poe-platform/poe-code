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
const builtInCorpusByteLength = Buffer.byteLength(builtInCorpusText, "utf8");

type EncodingCache = {
  prefixCharLength: number;
  prefixTokens: Uint32Array;
};

const prefixCacheByEncoding = new Map<TiktokenEncoding, EncodingCache>();

function getEncodingCache(encoding: TiktokenEncoding): EncodingCache {
  const cached = prefixCacheByEncoding.get(encoding);
  if (cached) {
    return cached;
  }

  const initial = {
    prefixCharLength: 0,
    prefixTokens: new Uint32Array(0)
  };
  prefixCacheByEncoding.set(encoding, initial);
  return initial;
}

function nextPrefixLength(currentLength: number, targetTokenCount: number): number {
  if (currentLength === 0) {
    return Math.max(256, targetTokenCount * 8);
  }
  return Math.max(currentLength * 2, currentLength + 4096);
}

function ensurePrefixTokens(args: {
  cache: EncodingCache;
  tokenCount: number;
  encode: (text: string) => Uint32Array;
}): Uint32Array {
  const { cache, tokenCount, encode } = args;
  if (cache.prefixTokens.length >= tokenCount) {
    return cache.prefixTokens;
  }

  const corpusLength = builtInCorpusText.length;
  while (
    cache.prefixTokens.length < tokenCount &&
    cache.prefixCharLength < corpusLength
  ) {
    const nextLength = Math.min(
      corpusLength,
      nextPrefixLength(cache.prefixCharLength, tokenCount)
    );
    cache.prefixCharLength = nextLength;
    cache.prefixTokens = encode(builtInCorpusText.slice(0, nextLength));
  }

  return cache.prefixTokens;
}

export function tokenfill(tokenCount: number, options: TokenfillOptions = {}): TokenfillResult {
  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new TypeError(`tokenCount must be a non-negative integer, received ${tokenCount}`);
  }

  if (tokenCount > builtInCorpusByteLength) {
    throw new Error(
      `Requested token count ${tokenCount} exceeds built-in corpus size ${builtInCorpusByteLength} for encoding ${options.encoding ?? "default"}`
    );
  }

  const tokenizer = createTokenizer({ encoding: options.encoding });

  try {
    const cache = getEncodingCache(tokenizer.encoding);
    const prefixTokens = ensurePrefixTokens({
      cache,
      tokenCount,
      encode: tokenizer.encode
    });
    if (prefixTokens.length < tokenCount) {
      throw new Error(
        `Requested token count ${tokenCount} exceeds built-in corpus size ${prefixTokens.length} for encoding ${tokenizer.encoding}`
      );
    }

    const text = tokenizer.decode(prefixTokens.slice(0, tokenCount));

    return {
      text,
      actualTokens: tokenCount
    };
  } finally {
    tokenizer.free();
  }
}
