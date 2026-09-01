import { createCommandArguments, getCommandArguments, type CommandArguments } from "../contracts/command.js";
import { type ShellValue } from "../contracts/value.js";
import { decoder, encoder, UsageError, type ParsedOptions } from "./internal.js";

export class EnvSplitError extends Error {}

class SplitWork {
  private bytes = 0;
  private arguments = 0;
  private expansions = 0;
  private work = 0;
  private nextYield = 4096;

  constructor(private readonly signal: AbortSignal) {}

  account(text: string | Uint8Array): void {
    this.signal.throwIfAborted();
    if (text.length > 131072 - this.bytes) throw new EnvSplitError("split-string byte limit exceeded (131072)");
    this.bytes += typeof text === "string" ? Buffer.byteLength(text) : text.byteLength;
    if (this.bytes > 131072) throw new EnvSplitError("split-string byte limit exceeded (131072)");
    if (typeof text === "string" ? text.includes("\0") : text.includes(0)) throw new EnvSplitError("NUL is not supported in -S strings");
  }

  argument(): void {
    if (++this.arguments > 10000) throw new EnvSplitError("split-string argument limit exceeded (10000)");
  }

  expansion(): void {
    this.signal.throwIfAborted();
    if (++this.expansions > 32) throw new EnvSplitError("split-string expansion limit exceeded (32)");
    if (this.work > 1048576) throw new EnvSplitError("split-string work limit exceeded (1048576)");
  }

  tick(amount = 1): boolean {
    this.signal.throwIfAborted();
    this.work += amount;
    if (this.expansions && this.work > 1048576) throw new EnvSplitError("split-string work limit exceeded (1048576)");
    return this.work >= this.nextYield;
  }

  async pause(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
    this.signal.throwIfAborted();
    this.nextYield = this.work + 4096;
  }
}

async function splitString(source: string, environment: Readonly<Record<string, string>>, work: SplitWork): Promise<string[]> {
  work.expansion();
  work.account(source);
  const result: string[] = [];
  let parts: string[] = [];
  let active = false;
  let quote = "";
  const start = () => {
    if (!active) { work.argument(); active = true; }
  };
  const append = (text: string) => {
    work.account(text);
    start();
    parts.push(text);
  };
  const finish = () => {
    if (active) result.push(parts.join(""));
    parts = [];
    active = false;
  };
  for (let index = 0; index < source.length;) {
    if (work.tick()) await work.pause();
    const character = String.fromCodePoint(source.codePointAt(index)!);
    if ((character === "'" || character === '"') && (!quote || character === quote)) {
      start();
      quote = quote ? "" : character;
      index++;
      continue;
    }
    if (!quote && /[ \t\n\r\v\f]/u.test(character)) {
      finish();
      index++;
      continue;
    }
    if (character === "#" && !active) break;
    if (character === "\\" && (quote !== "'" || source[index + 1] === "\\" || source[index + 1] === "'")) {
      const escaped = source[index + 1];
      if (escaped === undefined) throw new EnvSplitError("invalid backslash at end of string in -S");
      index += 2;
      if (escaped === "c") {
        if (quote === '"') throw new EnvSplitError("'\\c' must not appear in double-quoted -S string");
        break;
      }
      if (escaped === "_") {
        if (quote === '"') append(" ");
        else finish();
        continue;
      }
      const controls: Readonly<Record<string, string>> = { f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
      if (Object.hasOwn(controls, escaped)) append(controls[escaped]!);
      else if ('"#$\'\\'.includes(escaped)) append(escaped);
      else throw new EnvSplitError(`invalid sequence '\\${escaped}' in -S`);
      continue;
    }
    if (character === "$" && quote !== "'") {
      let end = index + 2;
      if (source[index + 1] !== "{" || !/^[A-Za-z_]$/u.test(source[end] ?? "")) {
        throw new EnvSplitError(`only \${VARNAME} expansion is supported, error at: ${source.slice(index)}`);
      }
      while (/^[A-Za-z_0-9]$/u.test(source[end] ?? "")) {
        if (work.tick()) await work.pause();
        end++;
      }
      if (source[end] !== "}") throw new EnvSplitError(`only \${VARNAME} expansion is supported, error at: ${source.slice(index)}`);
      const name = source.slice(index + 2, end);
      if (Object.hasOwn(environment, name)) {
        const text = environment[name]!;
        append(text);
        if (work.tick(text.length)) await work.pause();
      }
      index = end + 1;
      continue;
    }
    append(character);
    index += character.length;
  }
  if (quote) throw new EnvSplitError("no terminating quote in -S string");
  finish();
  return result;
}

async function splitBytes(source: Uint8Array, environment: Readonly<Record<string, string>>, work: SplitWork): Promise<Uint8Array[]> {
  work.expansion();
  work.account(source);
  const result: Uint8Array[] = [];
  let pending: number[] = [];
  let active = false;
  let quote = 0;
  const start = () => { if (!active) { work.argument(); active = true; } };
  const append = (bytes: Uint8Array) => {
    work.account(bytes);
    start();
    for (const byte of bytes) pending.push(byte);
  };
  const finish = () => {
    if (active) result.push(Uint8Array.from(pending));
    pending = [];
    active = false;
  };
  const nameStart = (byte: number | undefined): boolean => byte !== undefined && (byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte === 95);
  for (let index = 0; index < source.length;) {
    if (work.tick()) await work.pause();
    const character = source[index]!;
    if ((character === 39 || character === 34) && (!quote || character === quote)) { start(); quote = quote ? 0 : character; index++; continue; }
    if (!quote && [32, 9, 10, 13, 11, 12].includes(character)) { finish(); index++; continue; }
    if (character === 35 && !active) break;
    if (character === 92 && (quote !== 39 || source[index + 1] === 92 || source[index + 1] === 39)) {
      const escaped = source[index + 1];
      if (escaped === undefined) throw new EnvSplitError("invalid backslash at end of string in -S");
      index += 2;
      if (escaped === 99) {
        if (quote === 34) throw new EnvSplitError("'\\c' must not appear in double-quoted -S string");
        break;
      }
      if (escaped === 95) { if (quote === 34) append(Uint8Array.of(32)); else finish(); continue; }
      const controls: Readonly<Record<number, number>> = { 102: 12, 110: 10, 114: 13, 116: 9, 118: 11 };
      if (Object.hasOwn(controls, escaped)) append(Uint8Array.of(controls[escaped]!));
      else if ([34, 35, 36, 39, 92].includes(escaped)) append(Uint8Array.of(escaped));
      else throw new EnvSplitError(`invalid sequence '\\${String.fromCharCode(escaped)}' in -S`);
      continue;
    }
    if (character === 36 && quote !== 39) {
      let end = index + 2;
      if (source[index + 1] !== 123 || !nameStart(source[end])) throw new EnvSplitError(`only \${VARNAME} expansion is supported, error at: ${decoder.decode(source.subarray(index))}`);
      while (nameStart(source[end]) || source[end] !== undefined && source[end]! >= 48 && source[end]! <= 57) {
        if (work.tick()) await work.pause();
        end++;
      }
      if (source[end] !== 125) throw new EnvSplitError(`only \${VARNAME} expansion is supported, error at: ${decoder.decode(source.subarray(index))}`);
      const name = decoder.decode(source.subarray(index + 2, end));
      if (Object.hasOwn(environment, name)) {
        const text = environment[name]!;
        append(encoder.encode(text));
        if (work.tick(text.length)) await work.pause();
      }
      index = end + 1;
      continue;
    }
    append(source.subarray(index, index + 1));
    index++;
  }
  if (quote) throw new EnvSplitError("no terminating quote in -S string");
  finish();
  return result;
}

export async function parseEnvOptions(
  args: readonly string[], environment: Readonly<Record<string, string>>, signal: AbortSignal, argumentValues?: CommandArguments,
): Promise<ParsedOptions & { readonly operandValues?: CommandArguments }> {
  const work = new SplitWork(signal);
  const incoming = argumentValues === undefined ? createCommandArguments(args) : getCommandArguments({ args, argumentValues });
  const frames: { arguments: CommandArguments; offset: number }[] = [{ arguments: incoming, offset: 0 }];
  let currentValue: ShellValue = "";
  const next = (): string | undefined => {
    while (frames.length) {
      const frame = frames.at(-1)!;
      if (frame.offset < frame.arguments.args.length) {
        currentValue = frame.arguments.values[frame.offset]!;
        return frame.arguments.args[frame.offset++];
      }
      frames.pop();
    }
    return undefined;
  };
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const operands: string[] = [];
  const operandValues: ShellValue[] = [];
  const longOptions = new Map([
    ["ignore-environment", "i"], ["unset", "u"], ["null", "0"], ["chdir", "C"], ["split-string", "S"],
  ]);
  const accept = async (key: string, content?: string, source: ShellValue = content ?? "") => {
    if (key === "S") {
      const expanded = typeof source === "string" ? await splitString(source, environment, work) : await splitBytes(incoming.withValues([source]).bytes(0)!, environment, work);
      frames.push({ arguments: incoming.withValues(expanded), offset: 0 });
    } else {
      flags.add(key);
      if (content !== undefined) {
        const entries = values.get(key) ?? [];
        entries.push(content);
        values.set(key, entries);
      }
    }
  };
  for (;;) {
    const argument = next();
    if (argument === undefined) break;
    const argumentValue = currentValue;
    const remainder = (offset: number): ShellValue => typeof argumentValue === "string" ? argumentValue.slice(offset) : incoming.withValues([incoming.withValues([argumentValue]).bytes(0)!.subarray(offset)]).values[0]!;
    if (work.tick(argument.length + 1)) await work.pause();
    if (argument === "--") break;
    if (argument === "-" || !argument.startsWith("-")) { operands.push(argument); operandValues.push(argumentValue); break; }
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const key = longOptions.get(name);
      if (!key) throw new UsageError(`unrecognized option '${argument}'`);
      const required = key === "u" || key === "C" || key === "S";
      if (!required && equals >= 0) throw new UsageError(`option '--${name}' does not take an argument`);
      const content = required ? equals < 0 ? next() : argument.slice(equals + 1) : undefined;
      if (required && content === undefined) throw new UsageError(`option '--${name}' requires an argument`);
      await accept(key, content, key === "S" ? equals < 0 ? currentValue : remainder(equals + 1) : content);
      continue;
    }
    for (let index = 1; index < argument.length; index++) {
      if (work.tick()) await work.pause();
      const key = argument[index]!;
      if (key !== "i" && key !== "u" && key !== "0" && key !== "C" && key !== "S") throw new UsageError(`invalid option -- '${key}'`);
      const required = key === "u" || key === "C" || key === "S";
      const attached = argument.slice(index + 1);
      const content = required ? attached || next() : undefined;
      if (required && content === undefined) throw new UsageError(`option requires an argument -- '${key}'`);
      await accept(key, content, key === "S" ? attached ? remainder(index + 1) : currentValue : content);
      if (required) break;
    }
  }
  for (;;) {
    const argument = next();
    if (argument === undefined) break;
    if (work.tick()) await work.pause();
    operands.push(argument);
    operandValues.push(currentValue);
  }
  if (operands[0] === "-") { flags.add("i"); operands.shift(); operandValues.shift(); }
  signal.throwIfAborted();
  return { flags, values, operands, ...(argumentValues === undefined ? {} : { operandValues: incoming.withValues(operandValues) }) };
}
