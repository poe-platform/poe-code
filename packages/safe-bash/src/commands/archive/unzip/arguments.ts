import { getCommandArguments, readBytes, type ByteSource, type CommandContext } from "../../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../../contracts/value.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { checkPath, fail, text, type ArchiveLimits } from "../internal.js";

export function parseArguments(context: Pick<CommandContext, "args" | "argumentValues">, limits: ArchiveLimits) {
  const { args } = context;
  const rawArguments = context.argumentValues ? getCommandArguments(context) : undefined;
  const passwordArguments = new Set<number>();
  let bytes = 0;
  for (const argument of args) {
    bytes += Buffer.byteLength(argument) + 1;
    if (bytes > limits.maxArgumentBytes) fail("argument byte limit exceeded");
    if (argument.includes("\0")) fail("NUL in argument");
  }
  if (context.argumentValues) {
    const argumentsValue = getCommandArguments(context);
    let rawBytes = 0;
    for (const value of argumentsValue.values) {
      const size = shellValueByteLength(value) + 1;
      if (size > limits.maxArgumentBytes - rawBytes) fail("argument byte limit exceeded");
      rawBytes += size;
    }
  }
  let list = false;
  let test = false;
  let quiet = 0;
  let password: Uint8Array | undefined;
  let pipe = false;
  let overwrite = false;
  let destination: string | undefined;
  let archive: string | undefined;
  let ended = false;
  const patterns: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && argument.startsWith("-") && argument !== "-") {
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset];
        if (flag === "P") {
          const attached = offset + 1 < argument.length;
          const value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) fail("password option requires a value");
          passwordArguments.add(index);
          const raw = rawArguments?.bytes(index);
          password = raw ? new Uint8Array(raw.subarray(attached ? offset + 1 : 0)) : Buffer.from(value);
          break;
        } else if (flag === "t") test = true;
        else if (flag === "q") quiet++;
        else if (flag === "l") list = true;
        else if (flag === "p") pipe = true;
        else if (flag === "o") overwrite = true;
        else if (flag === "d") {
          if (destination !== undefined) fail("-d may only be specified once");
          destination = argument.slice(offset + 1) || args[++index];
          if (!destination) fail("must specify directory to which to extract with -d option");
          checkPath(destination, limits);
          break;
        } else fail(`unsupported option: -${flag}`);
      }
    } else if (archive === undefined) archive = argument;
    else patterns.push(argument);
  }
  if (rawArguments) for (const [index, value] of rawArguments.values.entries()) {
    if (!passwordArguments.has(index)) text(shellValueBytes(value));
  }
  if (archive === undefined) fail("usage: unzip [-l] [-p] [-t [-q[q]]] [-o] [-d DIR] ARCHIVE [FILES...]");
  checkPath(archive, limits);
  if (quiet && !test) fail("quiet is currently supported only with unzip test mode");
  if (test && (list || pipe || destination !== undefined)) fail("unzip test mode cannot be combined with listing, pipe or destination");
  return { test, quiet, password, list: list && !pipe, pipe, overwrite, destination, archive, patterns };
}

type Token = { kind: "star"; crossDirectories: boolean } | { kind: "any" | "never" } | { kind: "literal"; value: string }
  | { kind: "class"; ranges: readonly [number, number][]; negative: boolean };

function tokenize(pattern: string, noWild: boolean, stopAtDirectories: boolean): Token[] {
  const characters = Array.from(pattern);
  const tokens: Token[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    if (character === "*" && !noWild) {
      let count = 1;
      while (characters[index + 1] === "*") { count++; index++; }
      tokens.push({ kind: "star", crossDirectories: !stopAtDirectories || count > 1 });
    }
    else if (character === "?") tokens.push({ kind: "any" });
    else if (character === "\\" && !noWild) {
      const escaped = characters[++index];
      tokens.push(escaped === undefined ? { kind: "never" } : { kind: "literal", value: escaped });
    } else if (character === "[" && !noWild) {
      const negative = characters[index + 1] === "!" || characters[index + 1] === "^";
      if (negative) index++;
      const ranges: [number, number][] = [];
      const start = index + 1;
      let closing = start;
      let escaped = false;
      for (; closing < characters.length; closing++) {
        const current = characters[closing];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === "]") break;
      }
      // Info-ZIP recmatch defers a character followed by '-' and uses the
      // immediately preceding character for each range. Chained and trailing
      // hyphens therefore differ from conventional glob character classes.
      let first: number | undefined;
      escaped = characters[start] === "-";
      for (let position = start; position < closing; position++) {
        const current = characters[position]!;
        if (!escaped && current === "\\") escaped = true;
        else if (!escaped && current === "-") first = characters[position - 1]!.codePointAt(0);
        else {
          const last = current.codePointAt(0)!;
          if (characters[position + 1] !== "-") ranges.push([first ?? last, last]);
          first = undefined;
          escaped = false;
        }
      }
      index = closing;
      tokens.push(closing < characters.length ? { kind: "class", ranges, negative } : { kind: "never" });
    } else tokens.push({ kind: "literal", value: character });
  }
  return tokens;
}

export class Selection {
  private work = 0;
  private readonly patterns: readonly Token[][];
  private readonly tailComponents: readonly number[];
  private readonly emptyTailMatch: readonly boolean[];
  readonly matched = new Set<number>();
  constructor(patterns: readonly string[], private readonly limits: ArchiveLimits, private readonly signal: AbortSignal, private readonly options: { noWild?: boolean; stopAtDirectories?: boolean; trailingComponents?: boolean } = {}) {
    this.patterns = patterns.map(pattern => tokenize(pattern, options.noWild === true, options.stopAtDirectories === true));
    this.tailComponents = patterns.map(pattern => pattern.split("/").length);
    this.emptyTailMatch = patterns.map(pattern => !options.noWild && (pattern === "*" || options.stopAtDirectories === true && pattern === "**"));
  }
  private step(): void {
    if (++this.work > this.limits.maxPatternSteps) fail("pattern work limit exceeded");
  }
  async matches(name: string, firstMatchOnly = false): Promise<boolean> {
    if (!this.patterns.length) return true;
    const fullCharacters = Array.from(name);
    let selected = false;
    for (let pattern = 0; pattern < this.patterns.length; pattern++) {
      this.step();
      const characters = this.options.trailingComponents ? Array.from(name.split("/").slice(-this.tailComponents[pattern]!).join("/")) : fullCharacters;
      if (this.options.trailingComponents && !characters.length && !this.emptyTailMatch[pattern]) continue;
      let states = new Uint8Array(characters.length + 1);
      states[0] = 1;
      for (const token of this.patterns[pattern]!) {
        const next = new Uint8Array(states.length);
        for (let index = 0; index < states.length; index++) {
          this.step();
          if (token.kind === "star") next[index] = states[index]! || (index > 0 && (token.crossDirectories || characters[index - 1] !== "/") ? next[index - 1]! : 0);
          else if (states[index] && index < characters.length) {
            const character = characters[index]!;
            let match = token.kind === "any" && (!this.options.stopAtDirectories || character !== "/") || (token.kind === "literal" && token.value === character);
            if (token.kind === "class") {
              let inRange = false;
              for (const [first, last] of token.ranges) {
                this.step();
                if (character.codePointAt(0)! >= first && character.codePointAt(0)! <= last) inRange = true;
              }
              match = inRange !== token.negative;
            }
            if (match) next[index + 1] = 1;
          }
          if (this.work % 4096 === 0) await yieldTurn(this.signal);
        }
        states = next;
      }
      if (states[characters.length]) {
        this.matched.add(pattern);
        if (firstMatchOnly) return true;
        selected = true;
      }
    }
    return selected;
  }
}

export class Answers {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunk = new Uint8Array();
  private offset = 0;
  private bytes = 0;
  private pulls = 0;
  constructor(source: ByteSource, private readonly limits: ArchiveLimits, private readonly signal: AbortSignal) {
    this.iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  }
  async read(maximum = 9): Promise<string | undefined> {
    const answer: number[] = [];
    while (answer.length < maximum) {
      this.signal.throwIfAborted();
      if (this.offset === this.chunk.length) {
        if (++this.pulls > this.limits.maxPatternSteps) fail("overwrite input work limit exceeded");
        if (this.pulls % 64 === 0) await yieldTurn(this.signal);
        const next = await this.iterator.next();
        if (next.done) break;
        if (next.value.length > this.limits.maxFilesFromBytes - this.bytes) fail("overwrite input byte limit exceeded");
        this.bytes += next.value.length;
        this.chunk = Uint8Array.from(next.value);
        this.offset = 0;
        if (!this.chunk.length) continue;
      }
      const byte = this.chunk[this.offset++]!;
      answer.push(byte);
      if (byte === 10) break;
    }
    return answer.length ? Buffer.from(answer).toString("utf8") : undefined;
  }
  async close(): Promise<void> { await this.iterator.return?.(); }
}
