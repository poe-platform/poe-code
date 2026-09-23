import { isAsciiWhitespace } from "./scanner.js";

export function readWord(text: string, pos: number): { word: string; nextPos: number } {
  let i = pos;
  while (i < text.length && !isAsciiWhitespace(text[i]!)) i++;
  return { word: text.slice(pos, i), nextPos: i };
}
