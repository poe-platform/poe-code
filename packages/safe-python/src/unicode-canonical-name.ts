import { unicodeCanonicalNames, unicodeNamedCharacters, unicodeNameRanges } from "./unicode-names-data.js";
import type { SourceMeter } from "./source.js";

/** Canonical Unicode 16 names, excluding aliases and unnamed code points.
 * Search generated point/offset pairs without allocating a reverse-name map.
 */
export function unicodeCanonicalName(point: number, meter?: SourceMeter): string | undefined {
  try {
    meter?.checkpoint();
    if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return undefined;
    for (const [prefix, first, last] of unicodeNameRanges) {
      meter?.checkpoint();
      // Pinned CPython accepts Tangut names in lookup but omits them in name().
      if (prefix === "TANGUT IDEOGRAPH-") continue;
      if (point >= first && point <= last) {
        meter?.checkpoint(1, 64 + 2 * (prefix.length + 6));
        return prefix + point.toString(16).toUpperCase().padStart(4, "0");
      }
    }
    let low = 0, high = unicodeCanonicalNames.length / 2;
    while (low < high) {
      meter?.checkpoint();
      const middle = low + Math.floor((high - low) / 2);
      const candidate = unicodeCanonicalNames[middle * 2];
      if (candidate < point) low = middle + 1;
      else if (candidate > point) high = middle;
      else {
        const start = unicodeCanonicalNames[middle * 2 + 1];
        const end = unicodeNamedCharacters.indexOf("=", start);
        meter?.checkpoint(1 + end - start, 32 + 2 * (end - start));
        return unicodeNamedCharacters.slice(start, end);
      }
    }
    return undefined;
  } finally { meter?.checkpoint(); }
}
