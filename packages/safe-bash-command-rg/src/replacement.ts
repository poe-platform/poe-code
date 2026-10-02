import { bytesFrom, concatBytes } from "safe-bash-byte-engine";
import type { Match } from "./matcher.js";
import { SearchError } from "./options.js";

type Part = Uint8Array | string | number;

export class Replacement {
  private readonly parts: Part[] = [];

  constructor(source: string) {
    let literal = "";
    const flush = () => {
      if (literal) this.parts.push(bytesFrom(literal));
      literal = "";
    };
    for (let offset = 0; offset < source.length;) {
      if (source[offset] !== "$") { literal += source[offset++]!; continue; }
      if (source[offset + 1] === "$") { literal += "$"; offset += 2; continue; }
      const braced = source[offset + 1] === "{";
      const start = offset + (braced ? 2 : 1);
      let end = start;
      let numeric = true;
      while (end < source.length) {
        const c = source.charCodeAt(end);
        const digit = c >= 48 && c <= 57;
        if (!digit && c !== 95 && !(c >= 65 && c <= 90) && !(c >= 97 && c <= 122)) break;
        numeric &&= digit;
        end++;
      }
      if (end === start || braced && source[end] !== "}") { literal += "$"; offset++; continue; }
      flush();
      const key = source.slice(start, end);
      this.parts.push(numeric ? Number(key) : key);
      offset = end + (braced ? 1 : 0);
    }
    flush();
  }

  expand(bytes: Uint8Array, matches: readonly Match[], onlyMatching: boolean, maxBytes: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let size = 0, cursor = 0;
    const append = (part: Uint8Array) => {
      if (part.length > maxBytes - size) throw new SearchError("replacement output byte limit exceeded");
      size += part.length;
      if (part.length) parts.push(part);
    };
    for (const match of matches) {
      if (!onlyMatching) append(bytes.subarray(cursor, match.start));
      for (const part of this.parts) {
        if (part instanceof Uint8Array) append(part);
        else {
          const span = part === 0 ? match : match.captures?.get(part);
          if (span) append(bytes.subarray(span.start, span.end));
        }
      }
      cursor = match.end;
    }
    if (!onlyMatching) append(bytes.subarray(cursor));
    return concatBytes(parts, size);
  }
}
