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
  const utf8Decoder = new TextDecoder();

  const encode = (text: string): Uint32Array => tokenizer.encode(text);

  const decode = (tokens: Uint32Array | number[]): string => {
    const tokenArray = tokens instanceof Uint32Array ? tokens : Uint32Array.from(tokens);
    return utf8Decoder.decode(tokenizer.decode(tokenArray));
  };

  const count = (text: string): number => encode(text).length;

  const truncate = (text: string, tokenCount: number): string => {
    if (tokenCount <= 0) {
      return "";
    }

    const tokens = encode(text);
    if (tokens.length <= tokenCount) {
      return text;
    }

    return decode(tokens.slice(0, tokenCount));
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
