import { commandRuntimeIdentity } from "../../../contracts/command.js";
import { FsError } from "../../../contracts/errors.js";
import { concatShellValues, shellValueByteLength, shellValueBytes, shellValueFromBytes, shellValueText, type ShellValue } from "../../../contracts/value.js";
import { yieldTurn } from "../../../contracts/yield.js";
import type { ShellExtension, ShellExtensionContext, ShellIndexedWriter, ShellInputBorrow } from "../../extensions.js";
import type { RawRecord } from "../../input.js";

export interface MapfileOptions {
  array: string;
  clear: boolean;
  count: number;
  delimiter: number;
  descriptor: number;
  origin: number;
  quantum: number;
  skip: number;
  trim: boolean;
  callback?: ShellValue;
}

export class MapfileArgumentError extends Error {
  constructor(readonly detail: ShellValue, readonly status: number, readonly usage = false) {
    super(shellValueText(detail));
    this.name = "MapfileArgumentError";
  }
}

function decimal(text: string, maximum: number): number | undefined {
  let start = 0;
  let end = text.length;
  while (start < end && " \t\n\r\v\f".includes(text[start]!)) start++;
  while (end > start && " \t\n\r\v\f".includes(text[end - 1]!)) end--;
  const beginning = start;
  if (text[start] === "+" || text[start] === "-") start++;
  if (start >= end) return undefined;
  for (let index = start; index < end; index++) if (text[index]! < "0" || text[index]! > "9") return undefined;
  const value = Number(text.slice(beginning, end));
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value || 0 : undefined;
}

export async function parseMapfileArguments(args: readonly ShellValue[], selectDescriptor: (descriptor: number) => Promise<void>): Promise<MapfileOptions | "help"> {
  const options: MapfileOptions = { array: "MAPFILE", clear: true, count: 0, delimiter: 10, descriptor: 0, origin: 0, quantum: 5000, skip: 0, trim: false };
  let offset = 0;
  while (offset < args.length) {
    const argument = args[offset]!;
    const bytes = shellValueBytes(argument);
    const text = shellValueText(argument);
    if (text === "--help") return "help";
    if (text === "--") { offset++; break; }
    if (bytes[0] !== 45 || bytes.length === 1) break;
    offset++;
    for (let index = 1; index < bytes.length; index++) {
      const flag = String.fromCharCode(bytes[index]!);
      if (flag === "t") { options.trim = true; continue; }
      if (!"dnOsuCc".includes(flag)) throw new MapfileArgumentError(concatShellValues(["-", bytes[index]! < 128 ? flag : shellValueFromBytes(bytes.subarray(index, index + 1)), ": invalid option"]), 2, true);
      let value: ShellValue;
      if (index + 1 < bytes.length) value = typeof argument === "string" ? argument.slice(index + 1) : shellValueFromBytes(bytes.subarray(index + 1));
      else if (offset < args.length) value = args[offset++]!;
      else throw new MapfileArgumentError(`-${flag}: option requires an argument`, 2, true);
      if (flag === "d") options.delimiter = shellValueBytes(value)[0] ?? 0;
      else if (flag === "C") options.callback = value;
      else {
        const number = decimal(shellValueText(value), flag === "u" ? 2147483647 : 4294967295);
        if (number === undefined || flag === "c" && number === 0) {
          const detail = flag === "u" ? "file descriptor specification" : flag === "O" ? "array origin" : flag === "c" ? "callback quantum" : "line count";
          throw new MapfileArgumentError(concatShellValues([value, `: invalid ${detail}`]), 1);
        }
        if (flag === "u") { options.descriptor = number; await selectDescriptor(number); }
        else if (flag === "n") options.count = number;
        else if (flag === "O") { options.origin = number; options.clear = false; }
        else if (flag === "s") options.skip = number;
        else options.quantum = number;
      }
      break;
    }
  }
  const name = args[offset];
  if (name !== undefined) {
    const bytes = shellValueBytes(name);
    if (!bytes.length) throw new MapfileArgumentError("empty array variable name", 2);
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index]!;
      if (byte !== 95 && !(byte >= 65 && byte <= 90) && !(byte >= 97 && byte <= 122) && !(index > 0 && byte >= 48 && byte <= 57)) throw new MapfileArgumentError(concatShellValues(["`", name, "': not a valid identifier"]), 1);
    }
    options.array = shellValueText(name);
  }
  return options;
}

const synopsis = "[-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]";
const help = [
  "    Read lines from the standard input into an indexed array variable.",
  "    ",
  "    Read lines from the standard input into the indexed array variable ARRAY, or",
  "    from file descriptor FD if the -u option is supplied.  The variable MAPFILE",
  "    is the default ARRAY.",
  "    ",
  "    Options:",
  "      -d delim\tUse DELIM to terminate lines, instead of newline",
  "      -n count\tCopy at most COUNT lines.  If COUNT is 0, all lines are copied",
  "      -O origin\tBegin assigning to ARRAY at index ORIGIN.  The default index is 0",
  "      -s count\tDiscard the first COUNT lines read",
  "      -t\tRemove a trailing DELIM from each line read (default newline)",
  "      -u fd\tRead lines from file descriptor FD instead of the standard input",
  "      -C callback\tEvaluate CALLBACK each time QUANTUM lines are read",
  "      -c quantum\tSpecify the number of lines read between each call to",
  "    \t\t\tCALLBACK",
  "    ",
  "    Arguments:",
  "      ARRAY\tArray variable name to use for file data",
  "    ",
  "    If -C is supplied without -c, the default quantum is 5000.  When",
  "    CALLBACK is evaluated, it is supplied the index of the next array",
  "    element to be assigned and the line to be assigned to that element",
  "    as additional arguments.",
  "    ",
  "    If not supplied with an explicit origin, mapfile will clear ARRAY before",
  "    assigning to it.",
  "    ",
  "    Exit Status:",
  "    Returns success unless an invalid option is given or ARRAY is readonly or",
  "    not an indexed array.",
  "",
].join("\n");

async function callbackSource(callback: ShellValue, index: number, line: Uint8Array, signal: AbortSignal): Promise<ShellValue> {
  let quotes = 0;
  for (let offset = 0; offset < line.length; offset++) {
    if (offset % 4096 === 0) await yieldTurn(signal);
    if (line[offset] === 39) quotes++;
  }
  const quoted = new Uint8Array(line.length + quotes * 3 + 2);
  let offset = 0;
  quoted[offset++] = 39;
  for (let position = 0; position < line.length; position++) {
    if (position % 4096 === 0) await yieldTurn(signal);
    const byte = line[position]!;
    if (byte === 39) { quoted[offset++] = 39; quoted[offset++] = 92; quoted[offset++] = 39; }
    quoted[offset++] = byte;
  }
  quoted[offset] = 39;
  const separator = ` ${index | 0} `;
  const callbackLength = shellValueByteLength(callback);
  const capacity = callbackLength + quoted.length + 10 + 3;
  const remaining = capacity - 1 - callbackLength - separator.length;
  return concatShellValues([callback, separator, shellValueFromBytes(quoted.subarray(0, remaining))]);
}

async function execute(context: ShellExtensionContext): Promise<number> {
  const inputOwner: { input?: ShellInputBorrow } = {};
  let writer: ShellIndexedWriter | undefined;
  let record: RawRecord | undefined;
  let closed = false;
  let completion: Promise<void> | undefined;
  const operation: { work?: Promise<number> } = {};
  const check = (): void => { context.signal.throwIfAborted(); if (closed) throw new Error("Mapfile invocation is closed"); };
  const retire = async (): Promise<void> => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => record?.release()),
      Promise.resolve().then(() => writer?.close()),
      Promise.resolve().then(() => inputOwner.input?.release()),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  };
  const close = (): Promise<void> => {
    closed = true;
    return completion ??= (async () => {
      let failure: { reason: unknown } | undefined;
      try { await retire(); } catch (reason) { failure = { reason }; }
      await Promise.allSettled([operation.work]);
      try { await retire(); } catch (reason) { failure ??= { reason }; }
      if (failure) throw failure.reason;
    })();
  };
  context.registerCleanup(close);
  const validateDescriptor = async (descriptor: number): Promise<void> => {
    check();
    try { context.input.validateOpen(descriptor); }
    catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof FsError && error.code === "EBADF") throw new MapfileArgumentError(`${descriptor}: invalid file descriptor: Bad file descriptor`, 1);
      throw error;
    }
    check();
  };
  const work = Promise.resolve().then(async () => {
    try {
      check();
      const options = await parseMapfileArguments(context.argumentValues, validateDescriptor);
      check();
      if (options === "help") {
        const body = context.command === "readarray" ? "    Read lines from a file into an array variable.\n    \n    A synonym for `mapfile'.\n" : help;
        await context.stdout.write(new TextEncoder().encode(`${context.command}: ${context.command} ${synopsis}\n${body}`));
        return 2;
      }
      if (context.bindings.describe(options.array).readonly) {
        await context.diagnostic(`${options.array}: readonly variable`);
        return 1;
      }
      writer = await context.bindings.openIndexed(options.array, { clear: options.clear });
      check();
      try {
        inputOwner.input = context.input.borrow(options.descriptor);
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof FsError && error.code === "EBADF") return 0;
        throw error;
      }
      check();
      let reads = 0;
      const read = async (): Promise<boolean> => {
        if (++reads % 128 === 0) await yieldTurn(context.signal);
        check();
        let incoming: RawRecord;
        try { incoming = await inputOwner.input!.record({ delimiter: options.delimiter }); }
        catch (error) { context.signal.throwIfAborted(); if (error instanceof FsError) return false; throw error; }
        record = incoming;
        check();
        return incoming.reason !== "eof" || shellValueByteLength(incoming.shellValue) !== 0;
      };
      const release = async (): Promise<void> => { await record?.release(); record = undefined; };
      for (let skipped = 0; skipped < options.skip; skipped++) {
        if (!await read()) return 0;
        await release();
      }
      let index = options.origin;
      let count = 1;
      while (await read()) {
        const bytes = shellValueBytes(record!.shellValue);
        const nul = bytes.indexOf(0);
        let length = nul < 0 ? bytes.length : nul;
        if (options.trim && length && bytes[length - 1] === options.delimiter) length--;
        const line = bytes.subarray(0, length);
        if (options.callback !== undefined && count !== 0 && count % options.quantum === 0) {
          const source = await callbackSource(options.callback, index, line, context.signal);
          check();
          await context.evaluate(source, { name: "stdin" });
          check();
        }
        await writer.set(index, shellValueFromBytes(line));
        check();
        await release();
        count = (count + 1) >>> 0;
        if (options.count && count > options.count) break;
        index = (index + 1) >>> 0;
      }
      return 0;
    } catch (error) {
      context.signal.throwIfAborted();
      if (!(error instanceof MapfileArgumentError)) throw error;
      check();
      await context.diagnostic(concatShellValues([`${context.command}: `, error.detail]));
      if (error.usage) await context.stderr.write(new TextEncoder().encode(`${context.command}: usage: ${context.command} ${synopsis}\n`));
      return error.status;
    }
  });
  operation.work = work;
  let result = 1;
  let failure: { reason: unknown } | undefined;
  try { result = await work; } catch (reason) { failure = { reason }; }
  try { await close(); } catch (reason) { failure ??= { reason }; }
  context.signal.throwIfAborted();
  if (failure) throw failure.reason;
  return result;
}

export function mapfileExtension(): ShellExtension {
  return { name: "mapfile", runtimeIdentity: commandRuntimeIdentity, syntax: { arrayKeys: true }, create: () => ({ builtins: [{ name: "mapfile", execute }, { name: "readarray", execute }] }) };
}
