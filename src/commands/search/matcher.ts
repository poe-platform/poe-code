import { isAscii } from "node:buffer";
import { SearchError, type Arguments } from "./options.js";

export interface Match { readonly start: number; readonly end: number }

function decode(bytes: Uint8Array): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset]!;
    let length = first < 128 ? 1 : first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    let consumed = 1;
    if (length > 1) {
      for (; consumed < length; consumed++) {
        const next = bytes[offset + consumed];
        if (next === undefined || next < 0x80 || next > 0xbf || consumed === 1 && (first === 0xe0 && next < 0xa0 || first === 0xed && next >= 0xa0 || first === 0xf0 && next < 0x90 || first === 0xf4 && next >= 0x90)) break;
      }
      if (consumed < length) length = 0;
    }
    const character = length ? Buffer.from(bytes.subarray(offset, offset + length)).toString("utf8") : "\ufffd";
    offsets.push(offset);
    if (character.length === 2) offsets.push(offset);
    text += character;
    offset += length || consumed;
  }
  offsets.push(bytes.length);
  return { text, offsets };
}

const escaped = (source: string) => source.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");

export class Matcher {
  private readonly regex: RegExp | undefined;
  constructor(patterns: readonly string[], args: Arguments) {
    if (patterns.length > 1024) throw new SearchError("pattern count limit exceeded");
    if (!patterns.length) return;
    const insensitive = args.case === "insensitive" || args.case === "smart" && !patterns.some(pattern => /\p{Lu}/u.test(pattern));
    const sources = patterns.map(pattern => {
      if (Buffer.byteLength(pattern) > 8192) throw new SearchError("pattern byte limit exceeded");
      if (pattern.includes("\n") && !args.nullData) throw new SearchError("multiline matching is not supported");
      if (args.fixed) return escaped(pattern);
      if (/\\[1-9]|\(\?(?:[=!]|<[=!]|P[<=])/u.test(pattern)) throw new SearchError("backreferences and look-around are not supported");
      return pattern;
    });
    let source = sources.map(pattern => `(?:${pattern})`).join("|");
    if (args.whole) source = `^(?:${source})$`;
    else if (args.word) source = `(?<![\\p{L}\\p{N}\\p{M}\\p{Pc}\\u200c\\u200d])(?:${source})(?![\\p{L}\\p{N}\\p{M}\\p{Pc}\\u200c\\u200d])`;
    try { this.regex = new RegExp(source, `gu${insensitive ? "i" : ""}`); }
    catch (error) { throw new SearchError(`invalid or unsupported regular expression: ${error instanceof Error ? error.message : String(error)}`); }
  }
  matches(bytes: Uint8Array, all = true): Match[] {
    if (!this.regex) return [];
    const { text, offsets } = isAscii(bytes) ? { text: Buffer.from(bytes).toString("ascii"), offsets: undefined } : decode(bytes);
    const matches: Match[] = [];
    this.regex.lastIndex = 0;
    let previousEnd = -1;
    while (true) {
      const match = this.regex.exec(text);
      if (!match) break;
      const start = offsets?.[match.index] ?? match.index;
      const end = offsets?.[match.index + match[0].length] ?? match.index + match[0].length;
      if (start !== end || start !== previousEnd) matches.push({ start, end });
      if (!all && matches.length) break;
      previousEnd = end;
      if (match[0].length === 0) {
        if (this.regex.lastIndex === text.length) break;
        this.regex.lastIndex += text.codePointAt(this.regex.lastIndex)! > 0xffff ? 2 : 1;
      }
      if (matches.length > 100000) throw new SearchError("matches per line limit exceeded");
    }
    return matches;
  }
}
