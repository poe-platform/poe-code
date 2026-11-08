import { isAsciiWhitespace } from "./scanner.js";

export function readWord(
  text: string,
  pos: number
): { word: string; nextPos: number; next: number } {
  let i = pos;
  while (i < text.length && !isAsciiWhitespace(text[i]!)) i++;
  return { word: text.slice(pos, i), nextPos: i, next: i };
}

export function skipSpaces(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && isAsciiWhitespace(text[i]!)) i++;
  return i;
}

export function trimWhitespace(text: string): string {
  let start = 0;
  while (start < text.length && isAsciiWhitespace(text[start]!)) start++;
  let end = text.length;
  while (end > start && isAsciiWhitespace(text[end - 1]!)) end--;
  return text.slice(start, end);
}

export function stripQuotes(text: string): string {
  const trimmed = trimWhitespace(text);
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function indexOfChar(text: string, target: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === target) return i;
  }
  return -1;
}
