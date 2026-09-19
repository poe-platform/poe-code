import { lowerMappings, sigmaCased, sigmaIgnorable } from "./unicode-lower-profile.js";
import { integerWhitespace } from "./unicode-profile.js";
import { upperMappings } from "./unicode-upper-profile.js";

const upperMap = new Map(upperMappings);

/** CPython bytes str/repr, used by csv.writer for database BLOB results. */
export function bytesRepr(value: Uint8Array): string {
  const quote = value.includes(39) && !value.includes(34) ? '"' : "'";
  let text = 'b' + quote;
  for (const byte of value) {
    if (byte === 9) text += '\\t';
    else if (byte === 10) text += '\\n';
    else if (byte === 13) text += '\\r';
    else if (byte === 92 || byte === quote.charCodeAt(0)) text += '\\' + String.fromCharCode(byte);
    else if (byte >= 32 && byte < 127) text += String.fromCharCode(byte);
    else text += '\\x' + byte.toString(16).padStart(2, '0');
  }
  return text + quote;
}

/** Python uppercase may expand a scalar into several characters. */
export function upperText(value: string, step: () => void): string {
  let result = "";
  for (const char of value) {
    step();
    result += upperMap.get(char.codePointAt(0)!) ?? char;
  }
  return result;
}

export function stripWhitespace(value: string): string {
  const chars = Array.from(value);
  const whitespace = (char: string): boolean => {
    const code = char.codePointAt(0)!;
    return integerWhitespace.includes(code) || code >= 0x1c && code <= 0x1f;
  };
  let first = 0; let last = chars.length;
  while (first < last && whitespace(chars[first]!)) first++;
  while (last > first && whitespace(chars[last - 1]!)) last--;
  return chars.slice(first, last).join("");
}

export function* physicalLines(text: string, step: () => void): Generator<string> {
  let line = "";
  let cr = false;
  for (let char of text) {
    step();
    if (cr && char === "\n") { cr = false; continue; }
    cr = char === "\r";
    if (cr) char = "\n";
    line += char;
    if (char === "\n") { yield line; line = ""; }
  }
  if (line) yield line;
}

const lowerMap = new Map(lowerMappings);

/** CPython's frozen Unicode lowercase, including contextual Greek final sigma. */
export function lowerText(value: string): string {
  const chars = Array.from(value);
  const within = (code: number, ranges: readonly (readonly [number, number])[]): boolean => {
    let lo = 0; let hi = ranges.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; const range = ranges[mid]!; if (code < range[0]) hi = mid; else if (code > range[1]) lo = mid + 1; else return true; }
    return false;
  };
  return chars.map((char, index) => {
    const code = char.codePointAt(0)!;
    if (code !== 0x3a3) return lowerMap.get(code) ?? char;
    const cased = (direction: number): boolean => {
      for (let cursor = index + direction; cursor >= 0 && cursor < chars.length; cursor += direction) {
        const neighbor = chars[cursor]!.codePointAt(0)!;
        if (!within(neighbor, sigmaIgnorable)) return within(neighbor, sigmaCased);
      }
      return false;
    };
    return cased(-1) && !cased(1) ? "ς" : "σ";
  }).join("");
}
