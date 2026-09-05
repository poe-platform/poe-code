import type { RegexExecutionOptions } from "../regex-execution/protocol.js";
import { defaultFileTypes } from "./file-types.js";

export interface SearchOptions {
  readonly replace?: boolean;
  readonly defaultInput?: "auto" | "stdin" | "cwd";
  readonly maxOutputBytes?: number;
  readonly maxLineBytes?: number;
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
  readonly regex?: RegexExecutionOptions;
}

export class SearchError extends Error {}

export interface Arguments {
  patterns: string[];
  patternFiles: string[];
  paths: string[];
  explicitPatterns: boolean;
  mode: "lines" | "files" | "with" | "without" | "count" | "matches" | "json";
  case: "sensitive" | "insensitive" | "smart";
  fixed: boolean;
  invert: boolean;
  word: boolean;
  whole: boolean;
  lineNumber: boolean;
  column: boolean;
  byteOffset: boolean;
  filename?: boolean;
  onlyMatching: boolean;
  quiet: boolean;
  hidden: boolean;
  follow: boolean;
  ignore: boolean;
  ignoreVcs: boolean;
  ignoreDot: boolean;
  ignoreParent: boolean;
  requireGit: boolean;
  binary: "auto" | "binary" | "text";
  nullPath: boolean;
  nullData: boolean;
  crlf: boolean;
  includeZero: boolean;
  messages: boolean;
  heading: boolean;
  before: number;
  after: number;
  separator: string | undefined;
  maxCount: number;
  maxDepth: number;
  globs: { source: string; insensitive: boolean }[];
  types: { name: string; include: boolean }[];
}

export function count(value: string, flag: string): number {
  if (!/^[0-9]+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new SearchError(`${flag} requires a nonnegative integer`);
  return Number(value);
}

export function parse(args: readonly string[]): Arguments {
  const result: Arguments = {
    patterns: [], patternFiles: [], paths: [], explicitPatterns: false, mode: "lines", case: "sensitive",
    fixed: false, invert: false, word: false, whole: false, lineNumber: false, column: false, byteOffset: false,
    onlyMatching: false, quiet: false, hidden: false, follow: false, ignore: true, ignoreVcs: true,
    ignoreDot: true, ignoreParent: true, requireGit: true, binary: "auto", nullPath: false, nullData: false,
    crlf: false, includeZero: false, messages: true, heading: false, before: 0, after: 0, separator: "--",
    maxCount: Infinity, maxDepth: 128, globs: [], types: [],
  };
  const operands: string[] = [];
  let unrestricted = 0;
  let explicitLineNumber = false;
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (ended || argument === "-" || !argument.startsWith("-")) { operands.push(argument); continue; }
    if (argument === "--") { ended = true; continue; }
    const long = argument.startsWith("--");
    const equals = argument.indexOf("=");
    const flags = long ? [equals < 0 ? argument.slice(2) : argument.slice(2, equals)] : [...argument.slice(1)];
    let inline = long && equals >= 0 ? argument.slice(equals + 1) : undefined;
    for (let position = 0; position < flags.length; position++) {
      const flag = flags[position]!;
      let tookValue = false;
      const value = () => {
        tookValue = true;
        if (inline !== undefined) { const output = inline; inline = undefined; return output; }
        if (!long && position + 1 < flags.length) { const output = flags.slice(position + 1).join(""); position = flags.length; return output; }
        const output = args[++index];
        if (output === undefined) throw new SearchError(`${long ? "--" : "-"}${flag} requires a value`);
        return output;
      };
      switch (flag) {
        case "e": case "regexp": result.explicitPatterns = true; result.patterns.push(value()); break;
        case "f": case "file": result.explicitPatterns = true; result.patternFiles.push(value()); break;
        case "g": case "glob": result.globs.push({ source: value(), insensitive: false }); break;
        case "iglob": result.globs.push({ source: value(), insensitive: true }); break;
        case "t": case "type": case "T": case "type-not": {
          const name = value();
          if (result.types.length >= 1024) throw new SearchError("file type selection limit exceeded");
          if (name !== "all" && !Object.hasOwn(defaultFileTypes, name)) throw new SearchError(`unrecognized file type: ${name}`);
          result.types.push({ name, include: flag === "t" || flag === "type" });
          break;
        }
        case "n": case "line-number": result.lineNumber = true; explicitLineNumber = true; break;
        case "N": case "no-line-number": result.lineNumber = false; explicitLineNumber = true; break;
        case "H": case "with-filename": result.filename = true; break;
        case "I": case "no-filename": result.filename = false; break;
        case "i": case "ignore-case": result.case = "insensitive"; break;
        case "s": case "case-sensitive": result.case = "sensitive"; break;
        case "S": case "smart-case": result.case = "smart"; break;
        case "F": case "fixed-strings": result.fixed = true; break;
        case "no-fixed-strings": result.fixed = false; break;
        case "v": case "invert-match": result.invert = true; break;
        case "no-invert-match": result.invert = false; break;
        case "w": case "word-regexp": result.word = true; result.whole = false; break;
        case "x": case "line-regexp": result.whole = true; result.word = false; break;
        case "l": case "files-with-matches": result.mode = "with"; break;
        case "files-without-match": result.mode = "without"; break;
        case "files": result.mode = "files"; break;
        case "c": case "count": result.mode = "count"; break;
        case "count-matches": result.mode = "matches"; break;
        case "json": result.mode = "json"; break;
        case "o": case "only-matching": result.onlyMatching = true; break;
        case "no-only-matching": result.onlyMatching = false; break;
        case "q": case "quiet": result.quiet = true; break;
        case "L": case "follow": result.follow = true; break;
        case "no-follow": result.follow = false; break;
        case ".": case "hidden": result.hidden = true; break;
        case "no-hidden": result.hidden = false; break;
        case "no-ignore": result.ignore = false; break;
        case "ignore": result.ignore = true; break;
        case "no-ignore-vcs": result.ignoreVcs = false; break;
        case "no-ignore-dot": result.ignoreDot = false; break;
        case "no-ignore-parent": result.ignoreParent = false; break;
        case "no-require-git": result.requireGit = false; break;
        case "no-ignore-global": case "no-config": break;
        case "a": case "text": result.binary = "text"; break;
        case "binary": result.binary = "binary"; break;
        case "no-binary": case "no-text": result.binary = "auto"; break;
        case "u": case "unrestricted":
          unrestricted++; result.ignore = false;
          if (unrestricted >= 2) result.hidden = true;
          if (unrestricted >= 3) result.binary = "binary";
          break;
        case "0": case "null": result.nullPath = true; break;
        case "no-null": result.nullPath = false; break;
        case "null-data": result.nullData = true; break;
        case "crlf": result.crlf = true; break;
        case "include-zero": result.includeZero = true; break;
        case "no-include-zero": result.includeZero = false; break;
        case "no-messages": result.messages = false; break;
        case "messages": result.messages = true; break;
        case "heading": result.heading = true; break;
        case "no-heading": result.heading = false; break;
        case "column": result.column = true; break;
        case "no-column": result.column = false; break;
        case "b": case "byte-offset": result.byteOffset = true; break;
        case "A": case "after-context": result.after = count(value(), flag); break;
        case "B": case "before-context": result.before = count(value(), flag); break;
        case "C": case "context": result.before = result.after = count(value(), flag); break;
        case "context-separator": result.separator = value(); break;
        case "no-context-separator": result.separator = undefined; break;
        case "m": case "max-count": result.maxCount = count(value(), flag); break;
        case "max-depth": result.maxDepth = count(value(), flag); if (result.maxDepth > 128) throw new SearchError("maximum supported directory depth is 128"); break;
        case "sort": if (value() !== "path") throw new SearchError("only --sort=path is supported"); break;
        case "color": if (value() !== "never") throw new SearchError("only --color=never is supported"); break;
        default: throw new SearchError(`unsupported option '${long ? "--" : "-"}${flag}'`);
      }
      if (long && equals >= 0 && !tookValue) throw new SearchError(`--${flag} does not take a value`);
    }
  }
  if (result.before > 100000 || result.after > 100000) throw new SearchError("context limit exceeded");
  if (result.mode !== "files" && !result.explicitPatterns) {
    const pattern = operands.shift();
    if (pattern === undefined) throw new SearchError("a search pattern is required");
    result.patterns.push(pattern);
  }
  if (!explicitLineNumber) result.lineNumber = result.column;
  result.paths = operands;
  return result;
}
