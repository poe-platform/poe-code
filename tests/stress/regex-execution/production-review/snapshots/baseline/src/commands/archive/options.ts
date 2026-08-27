import { collectBytes, type CommandContext } from "../../contracts/index.js";
import { checkPath, fail, operation, smallFile, text, vfsPath, type ArchiveLimits } from "./internal.js";

export interface Operand { readonly name: string; readonly cwd: string }
export interface TarOptions {
  mode: "c" | "t" | "x";
  archive: string;
  gzip: boolean;
  verbose: boolean;
  strip: number;
  format: "pax" | "ustar";
  cwd: string;
  operands: Operand[];
  excludes: string[];
}

export async function parseOptions(context: CommandContext, limits: ArchiveLimits): Promise<TarOptions> {
  if (context.args.reduce((total, argument) => total + Buffer.byteLength(argument), 0) > limits.maxArgumentBytes) fail("argument byte limit exceeded");
  let mode: TarOptions["mode"] | undefined;
  let archive = "-";
  let gzip = false;
  let verbose = false;
  let strip = 0;
  let format: TarOptions["format"] = "pax";
  let cwd = context.cwd;
  let nullFiles = false;
  let verbatim = false;
  let filesFrom = false;
  let stdinUsed = false;
  let filesFromBytes = 0;
  let lateExclude = false;
  const operands: Operand[] = [];
  const excludes: string[] = [];
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
      ? await collectBytes(context.stdin, { maxBytes: limits.maxFilesFromBytes, signal: context.signal })
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
        if (!nullFiles && !verbatim && line.includes("\\")) fail("backslash quoting in file lists is unsupported; use --verbatim-files-from or --null");
        operand(line);
      }
    }
  };
  const apply = async (flag: string, value?: string) => {
    if (flag === "c" || flag === "t" || flag === "x") {
      if (mode) fail("exactly one of -c, -t, -x is required");
      mode = flag;
    } else if (flag === "z") gzip = true;
    else if (flag === "v") verbose = true;
    else if (flag === "f") { if (!value) fail("empty archive name"); archive = value; }
    else if (flag === "C") await directory(value!);
    else if (flag === "T") await names(value!);
    else if (flag === "exclude") { checkPath(value!, limits); if (operands.length) lateExclude = true; excludes.push(value!); }
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
  const long: Record<string, string> = { create: "c", list: "t", extract: "x", get: "x", file: "f", gzip: "z", verbose: "v", directory: "C", "files-from": "T" };
  const values = new Set(["f", "C", "T", "exclude", "strip-components", "format"]);
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
      if (!values.has(flag) && value !== undefined) fail(`option --${name} does not take an argument`);
      await apply(flag, value);
    } else if (!end && ((argument.startsWith("-") && argument !== "-") || (index === 0 && /^[ctxzvfCT]+$/u.test(argument)))) {
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
  if (!mode) fail("exactly one of -c, -t, -x is required");
  if (mode !== "c" && archive === "-" && stdinUsed) fail("archive and file list cannot both use standard input");
  if (mode === "c" && strip !== 0) fail("--strip-components is only supported when reading archives");
  if (mode === "c" && lateExclude) fail("--exclude after source operands is unsupported; place exclusions before operands");
  if (mode === "c" && !operands.length && !filesFrom) fail("refusing to create an empty archive without -T");
  if (archive !== "-") checkPath(archive, limits);
  return { mode, archive, gzip, verbose, strip, format, cwd, operands, excludes };
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
  constructor(patterns: readonly string[], readonly maxWork = 10_000_000) { this.patterns = patterns.map(tokenize); }
  matches(name: string): boolean {
    const characters = Array.from(name);
    for (const tokens of this.patterns) {
      let states = new Uint8Array(characters.length + 1);
      states[0] = 1;
      for (let index = 0; index < characters.length; index++) if (characters[index] === "/") states[index + 1] = 1;
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
