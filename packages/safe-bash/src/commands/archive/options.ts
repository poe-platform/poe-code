import { collectBytes, type CommandContext } from "../../contracts/index.js";
import { checkPath, fail, operation, smallFile, text, vfsPath, type ArchiveLimits } from "./internal.js";
import { parseTransform, type NameTransform } from "./transform.js";

export interface Operand { readonly name: string; readonly cwd: string }
export interface TarOptions {
  mode: "c" | "t" | "x" | "r" | "u" | "d" | "delete" | "A";
  archive: string;
  compression?: "gzip" | "bzip2" | "xz";
  verbose: boolean;
  toStdout: boolean;
  utc: boolean;
  recordSize: number;
  ignoreZeros: boolean;
  totals: boolean;
  quotingStyle: "literal" | "escape" | "c";
  showTransformedNames: boolean;
  transforms: NameTransform[];
  strip: number;
  format: "pax" | "ustar";
  cwd: string;
  operands: Operand[];
  excludes: string[];
  sort: "none" | "name";
  dereference: boolean;
  excludeCaches: boolean;
  wildcards: boolean;
  occurrence?: number;
  metadata: { mtime?: number; uid?: number; gid?: number; mode?: number; touch?: boolean; permissions?: boolean; fullTime?: boolean; delayDirectories?: boolean; preserveAtime?: boolean };
  overwrite: "replace" | "keep" | "skip";
}

export async function parseOptions(context: CommandContext, limits: ArchiveLimits): Promise<TarOptions | "help"> {
  if (context.args.reduce((total, argument) => total + Buffer.byteLength(argument), 0) > limits.maxArgumentBytes) fail("argument byte limit exceeded");
  let mode: TarOptions["mode"] | undefined;
  let archive = "-";
  let compression: TarOptions["compression"];
  let autoCompress = false;
  let verbose = false;
  let toStdout = false;
  let utc = false;
  let recordSize = 512;
  let ignoreZeros = false;
  let totals = false;
  let quotingStyle: TarOptions["quotingStyle"] = "escape";
  let sort: TarOptions["sort"] = "none";
  let dereference = false;
  let excludeCaches = false;
  let showTransformedNames = false;
  const transforms: NameTransform[] = [];
  let overwrite: TarOptions["overwrite"] = "replace";
  let strip = 0;
  let format: TarOptions["format"] = "pax";
  let cwd = context.cwd;
  let nullFiles = false;
  let verbatim = false;
  let filesFrom = false;
  let stdinUsed = false;
  let filesFromBytes = 0;
  let lateExclude = false;
  let wildcards = false;
  let occurrence: number | undefined;
  const metadata: TarOptions["metadata"] = {};
  const operands: Operand[] = [];
  const excludes: string[] = [];
  const exclude = (pattern: string) => {
    checkPath(pattern, limits);
    if (excludes.length >= limits.maxMembers) fail("exclude pattern limit exceeded");
    if (operands.length) lateExclude = true;
    excludes.push(pattern);
  };
  const operand = (name: string) => {
    checkPath(name, limits);
    if (operands.length >= limits.maxMembers) fail("operand limit exceeded");
    operands.push({ name, cwd });
  };
  const directory = async (name: string) => {
    checkPath(name, limits);
    const path = await operation(context, () => context.fs.realpath(vfsPath(cwd, name), { signal: context.signal }));
    const stat = await operation(context, () => context.fs.stat(path, { signal: context.signal }));
    if (stat.type !== "directory") fail(`not a directory: ${name}`);
    cwd = path;
  };
  const names = async (path: string) => {
    filesFrom = true;
    if (path === "-" && stdinUsed) fail("standard input file list can only be read once");
    const bytes = path === "-"
      ? await collectBytes(context.stdin, { ...(Number.isFinite(limits.maxFilesFromBytes) ? { maxBytes: limits.maxFilesFromBytes } : {}), signal: context.signal })
      : await smallFile(context, vfsPath(context.cwd, path), limits);
    if (path === "-") stdinUsed = true;
    filesFromBytes += bytes.length;
    if (filesFromBytes > limits.maxFilesFromBytes) fail("files-from byte limit exceeded");
    const contents = text(bytes);
    if (!nullFiles && contents.includes("\0")) fail("NUL in newline file list; use --null");
    const lines = contents.split(nullFiles ? "\0" : "\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      if (!line) continue;
      if (!nullFiles && !verbatim && line.startsWith("-")) {
        if (line === "-C") {
          const next = lines[++index];
          if (!next) fail("missing -C argument in file list");
          await directory(next);
        } else if (line.startsWith("-C") && !/\s/u.test(line[2] ?? "")) await directory(line.slice(2));
        else if (line.startsWith("--directory=")) await directory(line.slice(12));
        else fail(`unsupported option in file list: ${line}; use --verbatim-files-from for literal names`);
      } else {
        operand(!nullFiles && !verbatim ? unquoteFileName(line) : line);
      }
    }
  };
  const apply = async (flag: string, value?: string) => {
    if (flag === "c" || flag === "t" || flag === "x" || flag === "r" || flag === "u" || flag === "d" || flag === "delete" || flag === "A") {
      if (mode) fail("exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)");
      mode = flag;
    } else if (flag === "z" || flag === "j" || flag === "J") {
      const selected = flag === "z" ? "gzip" : flag === "j" ? "bzip2" : "xz";
      if (compression && compression !== selected) fail("conflicting compression options");
      compression = selected;
    } else if (flag === "a") autoCompress = true;
    else if (flag === "v") verbose = true;
    else if (flag === "O" || flag === "to-stdout") toStdout = true;
    else if (flag === "utc") { utc = true; verbose = true; }
    else if (flag === "totals") totals = true;
    else if (flag === "i") ignoreZeros = true;
    else if (flag === "B" || flag === "n" || flag === "no-seek" || flag === "force-local") {
      // VFS archives are always local byte streams; Reader already joins short reads
      // and consumes member bodies sequentially without requiring device seeking.
    }
    else if (flag === "b" || flag === "record-size") {
      let digits = value!;
      let multiplier = flag === "b" ? 512 : 1;
      if (flag === "record-size") {
        const suffixes: Record<string, number> = { c: 1, w: 2, b: 512, k: 1024, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
        const suffix = suffixes[digits.at(-1) ?? ""];
        if (suffix !== undefined) { multiplier = suffix; digits = digits.slice(0, -1); }
      }
      if (digits.startsWith("+")) digits = digits.slice(1);
      const size = Number(digits) * multiplier;
      if (!digits || ![...digits].every(character => "0123456789".includes(character)) || !Number.isSafeInteger(size) || size <= 0 || size % 512 !== 0) fail("record size must be a positive multiple of 512");
      if (size > limits.maxArchiveBytes) fail("record size exceeds archive byte limit");
      recordSize = size;
    }
    else if (flag === "quoting-style") {
      if (value !== "literal" && value !== "escape" && value !== "c") fail(`unsupported quoting style: ${value}; use literal, escape or c`);
      quotingStyle = value;
    }
    else if (flag === "sort") {
      if (value !== "name" && value !== "none") fail(`unsupported sort order: ${value}`);
      sort = value;
    }
    else if (flag === "h" || flag === "dereference") dereference = true;
    else if (flag === "exclude-caches") excludeCaches = true;
    else if (flag === "show-transformed-names") showTransformedNames = true;
    else if (flag === "transform") transforms.push(...parseTransform(value!));
    else if (flag === "atime-preserve") {
      if (value !== "replace") fail("only --atime-preserve=replace is supported; filesystem has no no-atime read capability");
      metadata.preserveAtime = true;
    }
    else if (flag === "full-time") metadata.fullTime = true;
    else if (flag === "numeric-owner" || flag === "no-same-owner") { /* IDs are numeric; extraction retains filesystem ownership. */ }
    else if (flag === "same-owner") fail("filesystem does not support restoring archive ownership");
    else if (flag === "m" || flag === "touch") metadata.touch = true;
    else if (flag === "p" || flag === "same-permissions" || flag === "preserve-permissions") metadata.permissions = true;
    else if (flag === "no-same-permissions") metadata.permissions = false;
    else if (flag === "delay-directory-restore") metadata.delayDirectories = true;
    else if (flag === "no-delay-directory-restore") metadata.delayDirectories = false;
    else if (flag === "owner" || flag === "group" || flag === "mode") {
      const radix = flag === "mode" ? 8 : 10;
      const digits = radix === 8 ? "01234567" : "0123456789";
      if (!value || ![...value].every(character => digits.includes(character))) fail(`invalid numeric ${flag}: ${value}`);
      const number = parseInt(value, radix);
      if (!Number.isSafeInteger(number) || (flag === "mode" && number > 0o7777)) fail(`invalid numeric ${flag}: ${value}`);
      if (flag === "owner") metadata.uid = number;
      else if (flag === "group") metadata.gid = number;
      else metadata.mode = number;
    } else if (flag === "mtime") {
      const seconds = value!.startsWith("@") ? Number(value!.slice(1)) : Date.parse(value!) / 1000;
      if (!value || value === "@" || !Number.isFinite(seconds) || Math.abs(seconds * 1000) > 8.64e15) fail(`invalid mtime: ${value}`);
      metadata.mtime = seconds;
    }
    else if (flag === "k" || flag === "keep-old-files") overwrite = "keep";
    else if (flag === "skip-old-files") overwrite = "skip";
    else if (flag === "overwrite") overwrite = "replace";
    else if (flag === "f") { if (!value) fail("empty archive name"); archive = value; }
    else if (flag === "C") await directory(value!);
    else if (flag === "T") await names(value!);
    else if (flag === "exclude") exclude(value!);
    else if (flag === "X") {
      if (value === "-" && stdinUsed) fail("standard input file list can only be read once");
      const bytes = value === "-"
        ? await collectBytes(context.stdin, { ...(Number.isFinite(limits.maxFilesFromBytes) ? { maxBytes: limits.maxFilesFromBytes } : {}), signal: context.signal })
        : await smallFile(context, vfsPath(context.cwd, value!), limits);
      if (value === "-") stdinUsed = true;
      filesFromBytes += bytes.length;
      if (filesFromBytes > limits.maxFilesFromBytes) fail("files-from byte limit exceeded");
      const contents = text(bytes);
      if (contents.includes("\0")) fail("NUL in exclusion file");
      for (const pattern of contents.split("\n")) if (pattern) exclude(pattern);
    }
    else if (flag === "wildcards") wildcards = true;
    else if (flag === "no-wildcards") wildcards = false;
    else if (flag === "occurrence") {
      const count = value ?? "1";
      if (!count || ![...count].every(character => "0123456789".includes(character)) || !Number.isSafeInteger(Number(count)) || Number(count) < 1) fail("invalid occurrence count");
      occurrence = Number(count);
    }
    else if (flag === "strip-components") {
      if (!/^[0-9]+$/u.test(value!) || !Number.isSafeInteger(Number(value))) fail("invalid strip-components count");
      strip = Number(value);
    } else if (flag === "format") {
      if (value !== "ustar" && value !== "pax" && value !== "posix") fail(`unsupported archive format: ${value}`);
      format = value === "ustar" ? "ustar" : "pax";
    } else if (flag === "null") { nullFiles = true; verbatim = true; }
    else if (flag === "no-null") nullFiles = false;
    else if (flag === "verbatim-files-from") verbatim = true;
    else if (flag === "no-verbatim-files-from") verbatim = false;
    else fail(`unsupported option: ${flag}`);
  };
  const long: Record<string, string> = { create: "c", list: "t", extract: "x", get: "x", append: "r", update: "u", compare: "d", diff: "d", catenate: "A", concatenate: "A", file: "f", gzip: "z", bzip2: "j", xz: "J", "auto-compress": "a", verbose: "v", directory: "C", "files-from": "T", "exclude-from": "X", xform: "transform", "blocking-factor": "b", "read-full-records": "B", "ignore-zeros": "i", seek: "n" };
  const values = new Set(["f", "C", "T", "X", "exclude", "strip-components", "format", "transform", "mtime", "owner", "group", "mode", "sort", "b", "record-size", "quoting-style"]);
  let end = false;
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    if (!end && argument === "--") { end = true; continue; }
    if (!end && argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const flag = long[name] ?? name;
      let value = equals < 0 ? undefined : argument.slice(equals + 1);
      if (values.has(flag) && value === undefined) value = context.args[++index];
      if (values.has(flag) && value === undefined) fail(`missing argument for --${name}`);
      if (flag === "atime-preserve" && value === undefined) value = "replace";
      if (!values.has(flag) && flag !== "atime-preserve" && flag !== "occurrence" && value !== undefined) fail(`option --${name} does not take an argument`);
      if (flag === "help") return "help";
      await apply(flag, value);
    } else if (!end && ((argument.startsWith("-") && argument !== "-") || (index === 0 && argument.length > 0 && [...argument].every(flag => "ctxrudAzjJavfCTXmpkhbBinO".includes(flag))))) {
      const old = !argument.startsWith("-");
      const cluster = old ? argument : argument.slice(1);
      for (let offset = 0; offset < cluster.length; offset++) {
        const flag = cluster[offset]!;
        let value: string | undefined;
        if (values.has(flag)) {
          value = !old && offset + 1 < cluster.length ? cluster.slice(offset + 1) : context.args[++index];
          if (value === undefined) fail(`missing argument for -${flag}`);
          if (!old) offset = cluster.length;
        }
        await apply(flag, value);
      }
    } else operand(argument);
  }
  if (!mode) fail("exactly one tar operation is required (-c, -t, -x, -r, -u, -d, --delete, -A)");
  const creating = mode === "c" || mode === "r" || mode === "u";
  if (occurrence !== undefined && (creating || mode === "A" || !operands.length)) fail("--occurrence requires member operands when reading archives");
  if (mode !== "t" && transforms.length) fail("--transform is currently supported only when listing archives");
  if (mode !== "c" && archive === "-" && stdinUsed) fail("archive and file list cannot both use standard input");
  if (mode !== "t" && mode !== "x" && strip !== 0) fail("--strip-components is only supported when listing or extracting archives");
  if (creating && lateExclude) fail("--exclude after source operands is unsupported; place exclusions before operands");
  if (mode === "c" && !operands.length && !filesFrom) fail("refusing to create an empty archive without -T");
  if (archive !== "-") checkPath(archive, limits);
  if (mode === "c" && autoCompress) {
    compression = archive.endsWith(".gz") || archive.endsWith(".tgz") ? "gzip"
      : archive.endsWith(".bz2") || archive.endsWith(".tbz2") || archive.endsWith(".tbz") ? "bzip2"
      : archive.endsWith(".xz") || archive.endsWith(".txz") ? "xz" : undefined;
  }
  return { mode, archive, ...(compression ? { compression } : {}), verbose, toStdout, utc, recordSize, ignoreZeros, totals, quotingStyle, showTransformedNames, transforms, strip, format, cwd, operands, excludes, sort, dereference, excludeCaches, wildcards, ...(occurrence !== undefined ? { occurrence } : {}), metadata, overwrite };
}

function unquoteFileName(name: string): string {
  const input = Buffer.from(name);
  const output: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92 };
  for (let index = 0; index < input.length; index++) {
    const byte = input[index]!;
    if (byte === 92 && index + 1 < input.length) {
      const next = input[index + 1]!;
      const escape = escapes[String.fromCharCode(next)];
      if (escape !== undefined) {
        output.push(escape);
        index++;
        continue;
      }
      const digits = input.subarray(index + 1, index + 4);
      if (digits.length === 3 && digits.every(digit => digit >= 48 && digit <= 55)) {
        output.push(((digits[0]! - 48) * 64 + (digits[1]! - 48) * 8 + digits[2]! - 48) & 255);
        index += 3;
        continue;
      }
    }
    output.push(byte);
  }
  return text(Uint8Array.from(output));
}

type Token = { kind: "star" } | { kind: "any" } | { kind: "literal"; value: string }
  | { kind: "class"; ranges: readonly [number, number][]; negative: boolean };

function tokenize(pattern: string): Token[] {
  const characters = Array.from(pattern);
  const tokens: Token[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    if (character === "*") { if (tokens.at(-1)?.kind !== "star") tokens.push({ kind: "star" }); }
    else if (character === "?") tokens.push({ kind: "any" });
    else if (character === "\\") {
      if (++index === characters.length) fail("trailing escape in exclude pattern");
      tokens.push({ kind: "literal", value: characters[index]! });
    } else if (character === "[") {
      const ranges: [number, number][] = [];
      index++;
      const negative = characters[index] === "!" || characters[index] === "^";
      if (negative) index++;
      while (index < characters.length && (characters[index] !== "]" || ranges.length === 0)) {
        const first = characters[index]!;
        if (first === "[" || first === "\\") fail("POSIX classes and escapes inside exclude brackets are unsupported");
        let last = first;
        if (characters[index + 1] === "-" && characters[index + 2] && characters[index + 2] !== "]") {
          last = characters[index + 2]!; index += 2;
        }
        if (first.codePointAt(0)! > last.codePointAt(0)!) fail("invalid exclude bracket range");
        ranges.push([first.codePointAt(0)!, last.codePointAt(0)!]);
        index++;
      }
      if (characters[index] !== "]") fail("unclosed exclude bracket");
      tokens.push({ kind: "class", ranges, negative });
    } else tokens.push({ kind: "literal", value: character });
  }
  return tokens;
}

export class Exclusions {
  private readonly patterns: Token[][];
  private work = 0;
  constructor(patterns: readonly string[], readonly maxWork = Infinity, private readonly anchored = false) { this.patterns = patterns.map(tokenize); }
  matches(name: string): boolean {
    const characters = Array.from(name);
    for (const tokens of this.patterns) {
      let states = new Uint8Array(characters.length + 1);
      states[0] = 1;
      if (!this.anchored) for (let index = 0; index < characters.length; index++) if (characters[index] === "/") states[index + 1] = 1;
      for (const token of tokens) {
        this.work += characters.length + 1;
        if (this.work > this.maxWork) fail("exclude pattern work limit exceeded");
        const next = new Uint8Array(states.length);
        for (let index = 0; index < states.length; index++) {
          if (token.kind === "star") next[index] = states[index]! || (index > 0 ? next[index - 1]! : 0);
          else if (states[index] && index < characters.length) {
            const character = characters[index]!;
            const matches = token.kind === "any" || (token.kind === "literal" ? token.value === character
              : token.ranges.some(([first, last]) => character.codePointAt(0)! >= first && character.codePointAt(0)! <= last) !== token.negative);
            if (matches) next[index + 1] = 1;
          }
        }
        states = next;
      }
      for (let index = 0; index < states.length; index++) if (states[index] && (index === characters.length || characters[index] === "/")) return true;
    }
    return false;
  }
}
