import { namedEntities } from "./entity-data.js";
const windows1252 = [
  8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143, 144, 8216,
  8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382, 376
];
export function asciiLower(s: string): string {
  let result = "";
  for (const c of s) {
    const n = c.charCodeAt(0);
    result += n >= 65 && n <= 90 ? String.fromCharCode(n + 32) : c;
  }
  return result;
}
export function htmlSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
}
export function decodeEntities(source: string, attribute: boolean): string {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "&") {
      out += source[i];
      continue;
    }
    if (source[i + 1] === "#") {
      let j = i + 2;
      const hex = asciiLower(source[j] ?? "") === "x";
      if (hex) j++;
      const start = j;
      let n = 0;
      while (j < source.length) {
        const c = source.charCodeAt(j);
        const d =
          c >= 48 && c <= 57
            ? c - 48
            : hex && c >= 65 && c <= 70
              ? c - 55
              : hex && c >= 97 && c <= 102
                ? c - 87
                : -1;
        if (d < 0) break;
        n = Math.min(0x110000, n * (hex ? 16 : 10) + d);
        j++;
      }
      if (j === start) {
        out += "&";
        continue;
      }
      if (source[j] === ";") j++;
      if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) n = 0xfffd;
      else if (n >= 128 && n <= 159) n = windows1252[n - 128]!;
      out += String.fromCodePoint(n);
      i = j - 1;
      continue;
    }
    let found = "";
    let end = i;
    // The longest HTML named reference is 32 ASCII characters including ';'.
    for (let j = i + 1; j <= Math.min(source.length, i + 32); j++) {
      const key = source.slice(i + 1, j + 1);
      if (Object.hasOwn(namedEntities, key)) {
        found = key;
        end = j;
      }
    }
    const next = source[end + 1] ?? "";
    const code = next.charCodeAt(0);
    if (
      !found ||
      (attribute &&
        !found.endsWith(";") &&
        (next === "=" ||
          (code >= 48 && code <= 57) ||
          (code >= 65 && code <= 90) ||
          (code >= 97 && code <= 122)))
    )
      out += "&";
    else {
      out += namedEntities[found];
      i = end;
    }
  }
  return out;
}
