import { unicodeNamedCharacters, unicodeNameRanges } from "./unicode-names-data.js";
import type {SourceMeter} from "./source.js";

/** Unicode 16 character names and aliases, excluding multi-character named sequences. */
export function lookupUnicodeName(name: string,meter?:SourceMeter): string | undefined {
  try {
  meter?.checkpoint();
  // Python's name lookup folds ASCII case, not Unicode lookalikes or whitespace.
  for (const character of name) {
    meter?.checkpoint();
    if (character.charCodeAt(0) >= 128) return undefined;
  }
  meter?.checkpoint(1+name.length,32+2*name.length);
  name = name.toUpperCase();
  meter?.checkpoint(0,48);
  for (const [prefix, first, last] of unicodeNameRanges) {
    meter?.checkpoint(1+prefix.length,48);
    if (!name.startsWith(prefix)) continue;
    meter?.checkpoint(1+name.length-prefix.length,32+2*(name.length-prefix.length));
    const hex = name.slice(prefix.length);
    const point = Number.parseInt(hex, 16);
    meter?.checkpoint(0,160);
    if (point >= first && point <= last && point.toString(16).toUpperCase().padStart(4, "0") === hex) {
      return String.fromCodePoint(point);
    }
  }
  // Binary search the sorted text directly: no startup allocation of a 45k-entry map.
  let low = 0;
  let high = unicodeNamedCharacters.length;
  while (low < high) {
    meter?.checkpoint();
    const middle = low + Math.floor((high - low) / 2);
    const start = unicodeNamedCharacters.lastIndexOf("\n", middle - 1) + 1;
    const separator = unicodeNamedCharacters.indexOf("=", start);
    const end = unicodeNamedCharacters.indexOf("\n", separator);
    meter?.checkpoint(1+end-start,32+2*(separator-start));
    const candidate = unicodeNamedCharacters.slice(start, separator);
    if (candidate === name) {
      meter?.checkpoint(0,96);
      return String.fromCodePoint(Number.parseInt(unicodeNamedCharacters.slice(separator + 1, end), 16));
    }
    if (candidate < name) low = end + 1;
    else high = start;
  }
  return undefined;
  } finally {meter?.checkpoint();}
}
