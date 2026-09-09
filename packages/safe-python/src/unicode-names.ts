import { unicodeNamedCharacters, unicodeNameRanges } from "./unicode-names-data.js";

/** Unicode 16 character names and aliases, excluding multi-character named sequences. */
export function lookupUnicodeName(name: string): string | undefined {
  // Python's name lookup folds ASCII case, not Unicode lookalikes or whitespace.
  for (const character of name) {
    if (character.charCodeAt(0) >= 128) return undefined;
  }
  name = name.toUpperCase();
  for (const [prefix, first, last] of unicodeNameRanges) {
    if (!name.startsWith(prefix)) continue;
    const hex = name.slice(prefix.length);
    const point = Number.parseInt(hex, 16);
    if (point >= first && point <= last && point.toString(16).toUpperCase().padStart(4, "0") === hex) {
      return String.fromCodePoint(point);
    }
  }
  // Binary search the sorted text directly: no startup allocation of a 45k-entry map.
  let low = 0;
  let high = unicodeNamedCharacters.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const start = unicodeNamedCharacters.lastIndexOf("\n", middle - 1) + 1;
    const separator = unicodeNamedCharacters.indexOf("=", start);
    const end = unicodeNamedCharacters.indexOf("\n", separator);
    const candidate = unicodeNamedCharacters.slice(start, separator);
    if (candidate === name) {
      return String.fromCodePoint(Number.parseInt(unicodeNamedCharacters.slice(separator + 1, end), 16));
    }
    if (candidate < name) low = end + 1;
    else high = start;
  }
  return undefined;
}
