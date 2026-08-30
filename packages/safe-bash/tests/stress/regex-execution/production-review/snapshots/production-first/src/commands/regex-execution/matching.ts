import { isAscii } from "node:buffer";
import type { Descriptor, GrepDescriptor, SearchDescriptor, Match } from "./protocol.js";

class SearchError extends Error {}
class UsageError extends Error {}


function decode(bytes: Uint8Array): { text: string; offsets: number[]; invalid: number[] } {
  let text = "";
  const offsets: number[] = [];
  const invalid: number[] = [];
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
    if (!length) invalid.push(text.length);
    offsets.push(offset);
    if (character.length === 2) offsets.push(offset);
    text += character;
    offset += length || 1;
  }
  offsets.push(bytes.length);
  return { text, offsets, invalid };
}

const escaped = (source: string) => source.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");

class SearchMatcher {
  private readonly regex: RegExp | undefined;
  private readonly byteEmpty: boolean;
  private readonly fragments = new Map<number, RegExp>();
  constructor(patterns: readonly string[], args: SearchDescriptor) {
    this.byteEmpty = patterns.length === 1 && patterns[0] === "" && !args.word && !args.whole;
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
  private fragmentRegex(atStart: boolean, atEnd: boolean): RegExp {
    if (atStart && atEnd) return this.regex!;
    const key = Number(atStart) + Number(atEnd) * 2;
    const cached = this.fragments.get(key);
    if (cached) return cached;
    let source = "";
    let characterClass = false;
    for (let index = 0; index < this.regex!.source.length; index++) {
      const character = this.regex!.source[index]!;
      if (character === "\\") { source += character + this.regex!.source[++index]!; continue; }
      if (character === "[") characterClass = true;
      else if (character === "]") characterClass = false;
      source += !characterClass && (character === "^" && !atStart || character === "$" && !atEnd) ? "(?!)" : character;
    }
    const regex = new RegExp(source, this.regex!.flags);
    this.fragments.set(key, regex);
    return regex;
  }
  matches(bytes: Uint8Array, all = true, terminated = true): Match[] {
    if (!this.regex) return [];
    if (this.byteEmpty) {
      const length = all ? bytes.length + Number(terminated) : 1;
      if (length > 100000) throw new SearchError("matches per line limit exceeded");
      return Array.from({ length }, (_value, offset) => ({ start: offset, end: offset }));
    }
    const { text, offsets, invalid } = isAscii(bytes) ? { text: Buffer.from(bytes).toString("ascii"), offsets: undefined, invalid: [] } : decode(bytes);
    const matches: Match[] = [];
    let previousEnd = -1;
    let fragmentStart = 0;
    for (const fragmentEnd of [...invalid, text.length]) {
      const fragment = text.slice(fragmentStart, fragmentEnd);
      const regex = this.fragmentRegex(fragmentStart === 0, fragmentEnd === text.length);
      regex.lastIndex = 0;
      while (true) {
        const match = regex.exec(fragment);
        if (!match) break;
        const first = fragmentStart + match.index;
        const last = first + match[0].length;
        const start = offsets?.[first] ?? first;
        const end = offsets?.[last] ?? last;
        if (start !== end || start !== previousEnd) matches.push({ start, end });
        if (matches.length > 100000) throw new SearchError("matches per line limit exceeded");
        if (!all && matches.length) return matches;
        previousEnd = end;
        if (match[0].length === 0) {
          if (regex.lastIndex === fragment.length) break;
          regex.lastIndex += fragment.codePointAt(regex.lastIndex)! > 0xffff ? 2 : 1;
        }
      }
      fragmentStart = fragmentEnd + 1;
    }
    return matches;
  }
}

function expression(pattern: string, extended: boolean): string {
  const classes: Record<string, string> = { digit: "0-9", lower: "a-z", upper: "A-Z", alpha: "A-Za-z", alnum: "A-Za-z0-9", space: "\\t\\n\\v\\f\\r ", blank: "\\t ", xdigit: "0-9A-Fa-f" };
  let source = pattern.replace(/\[:([a-z]+):\]/gu, (_whole, name: string) => {
    if (!classes[name]) throw new UsageError(`unsupported character class '${name}'`);
    return classes[name]!;
  });
  if (source.length > 65536) throw new UsageError("pattern is too large");
  if (!extended) {
    let translated = "";
    let bracket = false;
    for (let index = 0; index < source.length; index++) {
      const character = source[index]!;
      if (character === "\\" && index + 1 < source.length) {
        const next = source[++index]!;
        translated += !bracket && "(){}+?|".includes(next) ? next : `\\${next}`;
      } else {
        if (character === "[") bracket = true;
        if (character === "]") bracket = false;
        translated += !bracket && "(){}+?|".includes(character) ? `\\${character}` : character;
      }
    }
    source = translated;
  }
  if (source.includes("(?")) throw new UsageError("lookaround and special groups are not supported");
  return source;
}

function grepMatcher(args: GrepDescriptor): (bytes: Uint8Array, all: boolean) => Match[] {
  const matchers = args.patterns.map(pattern => {
    let source = args.fixed ? escaped(pattern) : expression(pattern, args.extended);
    if (args.whole) source = `^(?:${source})$`;
    try { return new RegExp(source, args.insensitive ? "gi" : "g"); }
    catch { throw new UsageError(`invalid regular expression '${pattern}'`); }
  });
  return (bytes, all) => {
    const text = Buffer.from(bytes).toString("latin1");
    const ranges: Match[] = [];
    for (const matcher of matchers) {
      matcher.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(text)) !== null) {
        const boundary = !args.word || !/[A-Za-z0-9_]/u.test(text[match.index - 1] ?? "") && !/[A-Za-z0-9_]/u.test(text[match.index + match[0].length] ?? "");
        if (boundary) {
          ranges.push({ start: match.index, end: match.index + match[0].length });
          if (!all) return ranges;
        }
        if (match[0] === "") matcher.lastIndex++;
      }
    }
    return ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  };
}

export function compile(descriptor: Descriptor): (bytes: Uint8Array, all: boolean, terminated: boolean) => Match[] {
  if (descriptor.kind === "grep") return grepMatcher(descriptor);
  const matcher = new SearchMatcher(descriptor.patterns, descriptor);
  return (bytes, all, terminated) => matcher.matches(bytes, all, terminated);
}
