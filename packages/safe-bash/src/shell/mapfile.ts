import { getCommandArguments, type CommandContext } from "../contracts/index.js";
import type { ShellValue, ValueAllocation } from "../contracts/value.js";
import { shellValueBytes } from "../contracts/value.js";
import { stringCheckpoint, type StringWork } from "./string-operations.js";
import type { ShellInput } from "./input.js";

export class MapfileUsageError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface MapfileOptions {
  name: string;
  strip: boolean;
  delimiter: number;
  count: number;
  skip: number;
  origin: number;
  preserve: boolean;
  callback: string | undefined;
  quantum: number;
}

export async function mapfileOptions(context: CommandContext, work: StringWork, allocation: ValueAllocation): Promise<MapfileOptions> {
  const options: MapfileOptions = { name: "MAPFILE", strip: false, delimiter: 10, count: 0, skip: 0, origin: 0, preserve: false, callback: undefined, quantum: 5000 };
  const args = getCommandArguments(context);
  let cursor = 0;
  const numeric = async (text: string, maximum: number): Promise<number> => {
    let value = 0;
    let index = 0;
    const whitespace = (code: number): boolean => code === 32 || (code >= 9 && code <= 13);
    while (index < text.length && whitespace(text.charCodeAt(index))) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      index++;
    }
    const negative = text[index] === "-";
    if (negative || text[index] === "+") index++;
    let digits = 0;
    for (; index < text.length; index++) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const digit = text.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9) break;
      if (value > Math.floor((maximum - digit) / 10)) throw new MapfileUsageError(`${text}: invalid number`, 1);
      value = value * 10 + digit;
      digits++;
    }
    for (; index < text.length; index++) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      if (!whitespace(text.charCodeAt(index))) throw new MapfileUsageError(`${text}: invalid number`, 1);
    }
    if (!digits || (negative && value !== 0)) throw new MapfileUsageError(`${text}: invalid number`, 1);
    return value;
  };
  while (cursor < context.args.length) {
    const option = context.args[cursor]!;
    if (option === "--") { cursor++; break; }
    if (!option.startsWith("-") || option === "-") break;
    cursor++;
    for (let index = 1; index < option.length; index++) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      const flag = option[index]!;
      if (flag === "t") { options.strip = true; continue; }
      if (!"dnsOCc".includes(flag)) throw new MapfileUsageError(`-${flag}: invalid option`, 2);
      const attached = index + 1 < option.length;
      const operandIndex = attached ? cursor - 1 : cursor++;
      const operand = attached ? option.slice(index + 1) : context.args[operandIndex];
      if (operand === undefined) throw new MapfileUsageError(`-${flag}: option requires an argument`, 2);
      if (flag === "d") {
        const bytes = shellValueBytes(args.values[operandIndex]!, allocation);
        options.delimiter = bytes[attached ? index + 1 : 0] ?? 0;
      } else if (flag === "C") options.callback = operand;
      else {
        const value = await numeric(operand, flag === "O" ? 2147483647 : Number.MAX_SAFE_INTEGER);
        if (flag === "c") { if (!value) throw new MapfileUsageError("0: invalid callback quantum", 1); options.quantum = value; }
        else if (flag === "n") options.count = value;
        else if (flag === "s") options.skip = value;
        else { options.origin = value; options.preserve = true; }
      }
      break;
    }
  }
  options.name = context.args[cursor] ?? "MAPFILE";
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(options.name)) throw new MapfileUsageError(`${options.name}: invalid identifier`, 1);
  return options;
}

export async function collectMapfile(options: MapfileOptions, input: ShellInput, hooks: {
  allocation(): ValueAllocation & { close(): void };
  loop(): void;
  write(index: number, value: ShellValue): Promise<void>;
  callback(source: string, index: number, value: ShellValue): Promise<void>;
}): Promise<void> {
  let skipped = 0;
  let written = 0;
  while (!options.count || written < options.count) {
    hooks.loop();
    const allocation = hooks.allocation();
    try {
      const record = await input.mapfileRecord(options.delimiter, options.strip, allocation);
      if (!record.present) break;
      if (skipped < options.skip) { skipped++; continue; }
      const index = options.origin + written;
      if (index > 2147483647) throw new MapfileUsageError("array index exceeds 2147483647", 1);
      if (options.callback !== undefined && (written + 1) % options.quantum === 0) await hooks.callback(options.callback, index, record.value);
      await hooks.write(index, record.value);
      written++;
    } finally { allocation.close(); }
  }
}
