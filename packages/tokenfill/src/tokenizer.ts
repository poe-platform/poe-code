import { get_encoding, type TiktokenEncoding } from "tiktoken";

export const DEFAULT_ENCODING: TiktokenEncoding = "cl100k_base";

export interface TokenizerOptions {
  encoding?: TiktokenEncoding;
}

export interface Tokenizer {
  readonly encoding: TiktokenEncoding;
  encode(text: string): Uint32Array;
  decode(tokens: Uint32Array | number[]): string;
  count(text: string): number;
  truncate(text: string, tokenCount: number): string;
  free(): void;
}

export function createTokenizer(options: TokenizerOptions = {}): Tokenizer {
  const encoding = options.encoding ?? DEFAULT_ENCODING;
  const tokenizer = get_encoding(encoding);
  const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

  const encode = (text: string): Uint32Array => tokenizer.encode(text);

  const normalizeDecodeTokens = (tokens: Uint32Array | number[]): Uint32Array => {
    if (tokens instanceof Uint32Array) {
      return tokens;
    }

    const tokenArray = new Uint32Array(tokens.length);
    tokens.forEach((token, index) => {
      if (!Number.isFinite(token) || !Number.isInteger(token) || token < 0 || token > 0xffffffff) {
        throw new TypeError(`token id at index ${index} must be a finite non-negative integer.`);
      }
      tokenArray[index] = token;
    });
    return tokenArray;
  };

  const decode = (tokens: Uint32Array | number[]): string => {
    const tokenArray = normalizeDecodeTokens(tokens);
    try {
      return strictUtf8Decoder.decode(tokenizer.decode(tokenArray));
    } catch {
      throw new Error("Cannot decode tokens without corrupting UTF-8 text.");
    }
  };

  const count = (text: string): number => encode(text).length;

  const truncate = (text: string, tokenCount: number): string => {
    if (!Number.isInteger(tokenCount) || tokenCount < 0) {
      throw new TypeError(`tokenCount must be a non-negative integer, received ${tokenCount}`);
    }

    if (tokenCount <= 0) {
      return "";
    }

    const tokens = encode(text);
    if (tokens.length <= tokenCount) {
      return text;
    }

    let truncated: string;
    try {
      truncated = strictUtf8Decoder.decode(tokenizer.decode(tokens.slice(0, tokenCount)));
    } catch {
      throw new Error(
        `Cannot truncate text to exactly ${tokenCount} tokens without corrupting UTF-8 text.`
      );
    }

    if (count(truncated) !== tokenCount) {
      throw new Error(
        `Cannot truncate text to exactly ${tokenCount} tokens without changing token boundaries.`
      );
    }

    return truncated;
  };

  return {
    encoding,
    encode,
    decode,
    count,
    truncate,
    free: () => tokenizer.free()
  };
}

let defaultTokenizer: Tokenizer | undefined;

export function countTokens(text: string): number {
  defaultTokenizer ??= createTokenizer();
  return defaultTokenizer.count(text);
}
