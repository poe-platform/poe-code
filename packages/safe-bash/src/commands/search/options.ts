import { PublicDiagnostic } from "../../diagnostics.js";
import type { RegexExecutionOptions } from "../regex-execution/protocol.js";
import type { BoundedRegexProvider } from "../regex-execution/provider.js";
import { defaultFileTypes } from "./file-types.js";

export interface SearchOptions {
  readonly replace?: boolean;
  readonly defaultInput?: "auto" | "stdin" | "cwd";
  readonly maxOutputBytes?: number;
  readonly maxLineBytes?: number;
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
  readonly maxPatternBytes?: number;
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
}

export class SearchError extends PublicDiagnostic {}

export interface Arguments {
  help?: boolean;
  version?: "short" | "long";
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
  stats?: boolean;
  hidden: boolean;
  follow: boolean;
  ignore: boolean;
  ignoreVcs: boolean;
  ignoreDot: boolean;
  ignoreParent: boolean;
  ignoreFiles: boolean;
  ignorePaths: string[];
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
  maxFileSize: number;
  replacement?: string;
  trim: boolean;
  multiline?: boolean;
  multilineDotall?: boolean;
  globs: { source: string; insensitive: boolean }[];
  types: { name: string; include: boolean }[];
}

export function count(value: string, flag: string): number {
  if (!value || [...value].some(character => character < "0" || character > "9") || !Number.isSafeInteger(Number(value))) throw new SearchError(`${flag} requires a nonnegative integer`);
  return Number(value);
}

function fileSize(value: string): number {
  const suffix = value.at(-1)!;
  const exponent = "KMG".indexOf(suffix) + 1;
  const amount = count(exponent ? value.slice(0, -1) : value, "max-filesize") * 1024 ** exponent;
  if (!Number.isSafeInteger(amount)) throw new SearchError("max-filesize is too large");
  return amount;
}

const EMPTY_STRINGS: string[] = [];
const EMPTY_GLOB_RULES: { source: string; insensitive: boolean }[] = [];
const EMPTY_TYPE_RULES: { name: string; include: boolean }[] = [];

class ParsedArguments implements Arguments {
  declare help?: boolean;
  declare version?: "short" | "long";
  patterns: string[] = [];
  declare patternFiles: string[];
  paths: string[] = [];
  declare explicitPatterns: boolean;
  declare mode: "lines" | "files" | "with" | "without" | "count" | "matches" | "json";
  declare case: "sensitive" | "insensitive" | "smart";
  declare fixed: boolean;
  declare invert: boolean;
  declare word: boolean;
  declare whole: boolean;
  declare lineNumber: boolean;
  declare column: boolean;
  declare byteOffset: boolean;
  declare filename?: boolean;
  declare onlyMatching: boolean;
  declare quiet: boolean;
  declare hidden: boolean;
  declare follow: boolean;
  declare ignore: boolean;
  declare ignoreVcs: boolean;
  declare ignoreDot: boolean;
  declare ignoreParent: boolean;
  declare ignoreFiles: boolean;
  declare ignorePaths: string[];
  declare requireGit: boolean;
  declare binary: "auto" | "binary" | "text";
  declare nullPath: boolean;
  declare nullData: boolean;
  declare crlf: boolean;
  declare includeZero: boolean;
  declare messages: boolean;
  declare heading: boolean;
  declare before: number;
  declare after: number;
  declare separator: string | undefined;
  declare maxCount: number;
  declare maxDepth: number;
  declare maxFileSize: number;
  declare replacement?: string;
  declare trim: boolean;
  declare multiline?: boolean;
  declare multilineDotall?: boolean;
  declare globs: { source: string; insensitive: boolean }[];
  declare types: { name: string; include: boolean }[];
  static {
    Object.assign(ParsedArguments.prototype, {
      patternFiles: EMPTY_STRINGS,
      explicitPatterns: false,
      mode: "lines",
      case: "sensitive",
      fixed: false,
      invert: false,
      word: false,
      whole: false,
      lineNumber: false,
      column: false,
      byteOffset: false,
      onlyMatching: false,
      quiet: false,
      hidden: false,
      follow: false,
      ignore: true,
      ignoreVcs: true,
      ignoreDot: true,
      ignoreParent: true,
      ignoreFiles: true,
      ignorePaths: EMPTY_STRINGS,
      requireGit: true,
      binary: "auto",
      nullPath: false,
      nullData: false,
      crlf: false,
      includeZero: false,
      messages: true,
      heading: false,
      before: 0,
      after: 0,
      separator: "--",
      maxCount: Infinity,
      maxDepth: Infinity,
      maxFileSize: Infinity,
      trim: false,
      multiline: false,
      multilineDotall: false,
      globs: EMPTY_GLOB_RULES,
      types: EMPTY_TYPE_RULES,
    });
  }
}

export function parse(args: readonly string[]): Arguments {
  const result: Arguments = new ParsedArguments();
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
    const singleShort = !long && argument.length === 2 ? argument.slice(1) : undefined;
    const flags = singleShort !== undefined
      ? undefined
      : (long ? [equals < 0 ? argument.slice(2) : argument.slice(2, equals)] : [...argument.slice(1)]);
    const flagsLen = singleShort !== undefined ? 1 : flags!.length;
    let inline = long && equals >= 0 ? argument.slice(equals + 1) : undefined;
    for (let position = 0; position < flagsLen; position++) {
      const flag = singleShort !== undefined ? singleShort : flags![position]!;
      let tookValue = false;
      const value = () => {
        tookValue = true;
        if (inline !== undefined) { const output = inline; inline = undefined; return output; }
        if (!long && position + 1 < flagsLen) { const output = flags!.slice(position + 1).join(""); position = flagsLen; return output; }
        const output = args[++index];
        if (output === undefined) throw new SearchError(`${long ? "--" : "-"}${flag} requires a value`);
        return output;
      };
      switch (flag) {
        case "h": case "help": result.help = true; break;
        case "V": result.version = "short"; break;
        case "version": result.version = "long"; break;
        case "e": case "regexp": result.explicitPatterns = true; result.patterns.push(value()); break;
        case "f": case "file": result.explicitPatterns = true; if (result.patternFiles === EMPTY_STRINGS) result.patternFiles = []; result.patternFiles.push(value()); break;
        case "g": case "glob": if (result.globs === EMPTY_GLOB_RULES) result.globs = []; result.globs.push({ source: value(), insensitive: false }); break;
        case "iglob": if (result.globs === EMPTY_GLOB_RULES) result.globs = []; result.globs.push({ source: value(), insensitive: true }); break;
        case "t": case "type": case "T": case "type-not": {
          const name = value();
          if (name !== "all" && !Object.hasOwn(defaultFileTypes, name)) throw new SearchError(`unrecognized file type: ${name}`);
          if (result.types === EMPTY_TYPE_RULES) result.types = [];
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
        case "stats": result.stats = true; break;
        case "no-stats": result.stats = false; break;
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
        case "ignore-file": if (result.ignorePaths === EMPTY_STRINGS) result.ignorePaths = []; result.ignorePaths.push(value()); break;
        case "no-ignore-files": result.ignoreFiles = false; break;
        case "ignore-files": result.ignoreFiles = true; break;
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
        case "maxdepth": case "max-depth": result.maxDepth = count(value(), flag); break;
        case "max-filesize": result.maxFileSize = fileSize(value()); break;
        case "r": case "replace": result.replacement = value(); break;
        case "trim": result.trim = true; break;
        case "no-trim": result.trim = false; break;
        case "U": case "multiline": result.multiline = true; break;
        case "no-multiline": result.multiline = false; break;
        case "multiline-dotall": result.multilineDotall = true; break;
        case "no-multiline-dotall": result.multilineDotall = false; break;
        case "P": case "pcre2": case "no-pcre2": break;
        case "j": case "threads": count(value(), flag); break;
        case "sort": if (value() !== "path") throw new SearchError("only --sort=path is supported"); break;
        case "color": if (value() !== "never") throw new SearchError("only --color=never is supported"); break;
        default: throw new SearchError(`unsupported option '${long ? "--" : "-"}${flag}'`);
      }
      if (long && equals >= 0 && !tookValue) throw new SearchError(`--${flag} does not take a value`);
    }
  }
  if (result.replacement?.includes("$")) throw new SearchError("replacement capture expansion is unsupported; use a literal replacement without '$'");
  if (!result.help && !result.version && result.mode !== "files" && !result.explicitPatterns) {
    const pattern = operands.shift();
    if (pattern === undefined) throw new SearchError("a search pattern is required");
    result.patterns.push(pattern);
  }
  if (!explicitLineNumber) result.lineNumber = result.column;
  result.paths = operands;
  return result;
}
