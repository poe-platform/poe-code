import { identifierStartRanges, identifierContinueRanges } from "./identifier-data.js";
import type { PythonSource, SourcePosition } from "./source.js";

export interface NameToken {
  readonly kind: "name";
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export function isIdentifierStart(point: number): boolean {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return false;
  if (point < 128) return point === 95 || (point >= 65 && point <= 90) || (point >= 97 && point <= 122);
  return containsCodePoint(identifierStartRanges, point);
}

export function isIdentifierContinue(point: number): boolean {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return false;
  if (point < 128) {
    return point === 95 || (point >= 48 && point <= 57) || (point >= 65 && point <= 90) || (point >= 97 && point <= 122);
  }
  return containsCodePoint(identifierContinueRanges, point);
}

/** Retain spelling: the parser must recognize keywords before NFKC normalization. */
export function readIdentifier(source: PythonSource): NameToken {
  const start = source.position;
  if (!isIdentifierStart(source.peek().codePointAt(0) ?? -1)) throw source.error("expected identifier", start);
  source.advance();
  while (isIdentifierContinue(source.peek().codePointAt(0) ?? -1)) source.advance();
  const end = source.position;
  return { kind: "name", text: source.text.slice(start.offset, end.offset), start, end };
}

function containsCodePoint(ranges: readonly number[], point: number): boolean {
  let low = 0;
  let high = ranges.length / 2;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (point < ranges[middle * 2]) high = middle;
    else if (point > ranges[middle * 2 + 1]) low = middle + 1;
    else return true;
  }
  return false;
}
