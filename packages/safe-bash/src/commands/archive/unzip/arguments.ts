import { getCommandArguments, readBytes, type ByteSource, type CommandContext } from "../../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../../contracts/value.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { checkPath, fail, text, type ArchiveLimits } from "../internal.js";

export function parseArguments(context: Pick<CommandContext, "args" | "argumentValues">, limits: ArchiveLimits) {
  const { args } = context;
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
    for (const value of argumentsValue.values) text(shellValueBytes(value));
  }
  let list = false;
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
        if (flag === "l") list = true;
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
  if (archive === undefined) fail("usage: unzip [-l] [-o] [-d DIR] ARCHIVE [FILES...]");
  checkPath(archive, limits);
  return { list, overwrite, destination, archive, patterns };
}

type Token = { kind: "star" | "any" | "never" } | { kind: "literal"; value: string }
  | { kind: "class"; ranges: readonly [number, number][]; negative: boolean };

function tokenize(pattern: string): Token[] {
  const characters = Array.from(pattern);
  const tokens: Token[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    if (character === "*") { if (tokens.at(-1)?.kind !== "star") tokens.push({ kind: "star" }); }
    else if (character === "?") tokens.push({ kind: "any" });
    else if (character === "\\") {
      const escaped = characters[++index];
      tokens.push(escaped === undefined ? { kind: "never" } : { kind: "literal", value: escaped });
    } else if (character === "[") {
      const negative = characters[index + 1] === "!" || characters[index + 1] === "^";
      if (negative) index++;
      const ranges: [number, number][] = [];
      let closed = false;
      while (++index < characters.length) {
        let first = characters[index]!;
        if (first === "]") { closed = true; break; }
        if (first === "\\") first = characters[++index] ?? "";
        let last = first;
        if (characters[index + 1] === "-" && characters[index + 2] && characters[index + 2] !== "]") {
          index += 2;
          last = characters[index]!;
          if (last === "\\") last = characters[++index] ?? "";
        }
        ranges.push([first.codePointAt(0) ?? -1, last.codePointAt(0) ?? -1]);
      }
      tokens.push(closed ? { kind: "class", ranges, negative } : { kind: "never" });
    } else tokens.push({ kind: "literal", value: character });
  }
  return tokens;
}

export class Selection {
  private work = 0;
  private readonly patterns: readonly Token[][];
  readonly matched = new Set<number>();
  constructor(patterns: readonly string[], private readonly limits: ArchiveLimits, private readonly signal: AbortSignal) {
    this.patterns = patterns.map(tokenize);
  }
  private step(): void {
    if (++this.work > this.limits.maxPatternSteps) fail("pattern work limit exceeded");
  }
  async matches(name: string): Promise<boolean> {
    if (!this.patterns.length) return true;
    const characters = Array.from(name);
    let selected = false;
    for (let pattern = 0; pattern < this.patterns.length; pattern++) {
      this.step();
      let states = new Uint8Array(characters.length + 1);
      states[0] = 1;
      for (const token of this.patterns[pattern]!) {
        const next = new Uint8Array(states.length);
        for (let index = 0; index < states.length; index++) {
          this.step();
          if (token.kind === "star") next[index] = states[index]! || (index > 0 ? next[index - 1]! : 0);
          else if (states[index] && index < characters.length) {
            const character = characters[index]!;
            let match = token.kind === "any" || (token.kind === "literal" && token.value === character);
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
      if (states[characters.length]) { this.matched.add(pattern); selected = true; }
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
