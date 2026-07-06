import { countTokens } from "./tokenizer.js";

export const EXACT_COUNT_CHAR_LIMIT = 8192;

const SAMPLE_CHUNK_LENGTH = 2048;

export function estimateTokens(text: string): number {
  if (text.length <= EXACT_COUNT_CHAR_LIMIT) {
    return countTokens(text);
  }

  const middleStart = Math.floor(text.length / 2 - SAMPLE_CHUNK_LENGTH / 2);
  const sample = [
    text.slice(0, SAMPLE_CHUNK_LENGTH),
    text.slice(middleStart, middleStart + SAMPLE_CHUNK_LENGTH),
    text.slice(text.length - SAMPLE_CHUNK_LENGTH)
  ]
    .map(trimBrokenSurrogates)
    .join("");
  const sampleTokens = countTokens(sample);
  if (sampleTokens === 0) {
    return 0;
  }

  return Math.round((text.length / sample.length) * sampleTokens);
}

function trimBrokenSurrogates(value: string): string {
  let start = 0;
  let end = value.length;
  if (end > start && isLowSurrogate(value.charCodeAt(start))) {
    start += 1;
  }
  if (end > start && isHighSurrogate(value.charCodeAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
