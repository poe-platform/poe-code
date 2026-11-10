import { getCommandArguments, type CommandContext } from "../contracts/index.js";
import type { ShellValue, ValueAllocation } from "../contracts/value.js";
import { shellValueBytes } from "../contracts/value.js";
import { stringCheckpoint, type StringWork } from "./string-operations.js";
import type { ShellInput } from "./input.js";

export class MapfileUsageError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface MapfileOptions {
  descriptor: number;
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

export async function mapfileOptions(context: CommandContext, work: StringWork, allocation: ValueAllocation, selectDescriptor: (descriptor: number) => void): Promise<MapfileOptions> {
  const options: MapfileOptions = { descriptor: 0, name: "MAPFILE", strip: false, delimiter: 10, count: 0, skip: 0, origin: 0, preserve: false, callback: undefined, quantum: 5000 };
  const args = getCommandArguments(context);
  let cursor = 0;
  const numeric = async (text: string, flag: string): Promise<number> => {
    const maximum = flag === "u" ? Number.MAX_SAFE_INTEGER : 4294967295;
    const diagnostic = flag === "u" ? "invalid file descriptor specification"
      : flag === "c" ? "invalid callback quantum"
      : flag === "O" ? "invalid array origin" : "invalid line count";
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
      if (value > Math.floor((maximum - digit) / 10)) throw new MapfileUsageError(`${text}: ${diagnostic}`, 1);
      value = value * 10 + digit;
      digits++;
    }
    for (; index < text.length; index++) {
      const pending = stringCheckpoint(work);
      if (pending) await pending;
      if (!whitespace(text.charCodeAt(index))) throw new MapfileUsageError(`${text}: ${diagnostic}`, 1);
    }
    if (!digits || (negative && value !== 0) || (flag === "c" && value === 0)) throw new MapfileUsageError(`${text}: ${diagnostic}`, 1);
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
      if (!"dnsOCcu".includes(flag)) throw new MapfileUsageError(`-${flag}: invalid option`, 2);
      const attached = index + 1 < option.length;
      const operandIndex = attached ? cursor - 1 : cursor++;
      const operand = attached ? option.slice(index + 1) : context.args[operandIndex];
      if (operand === undefined) throw new MapfileUsageError(`-${flag}: option requires an argument`, 2);
      if (flag === "d") {
        const bytes = shellValueBytes(args.values[operandIndex]!, allocation);
        options.delimiter = bytes[attached ? index + 1 : 0] ?? 0;
      } else if (flag === "C") options.callback = operand;
      else {
        const value = await numeric(operand, flag);
        if (flag === "u") {
          selectDescriptor(value);
          options.descriptor = value;
        } else if (flag === "c") options.quantum = value;
        else if (flag === "n") options.count = value;
        else if (flag === "s") options.skip = value;
        else { options.origin = value; options.preserve = true; }
      }
      break;
    }
  }
  options.name = context.args[cursor] ?? "MAPFILE";
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(options.name)) throw new MapfileUsageError(`\`${options.name}': not a valid identifier`, 1);
  return options;
}

export async function collectMapfile(options: MapfileOptions, getInput: () => ShellInput | undefined, hooks: {
  allocation(): ValueAllocation & { close(): void };
  loop(): void;
  tryWriteSync?(index: number, value: ShellValue): boolean;
  write(index: number, value: ShellValue): Promise<void>;
  callback(source: string, index: number, value: ShellValue): Promise<void>;
}): Promise<void> {
  let skipped = 0;
  let written = 0;
  while (!options.count || written < options.count) {
    hooks.loop();
    const input = getInput();
    if (!input || input._isViewClosed()) break;
    if (options.callback === undefined && hooks.tryWriteSync) {
      const fastRec = input.tryMapfileRecordSync(options.delimiter, options.strip);
      if (fastRec !== undefined) {
        if (!fastRec.present) break;
        if (skipped < options.skip) { skipped++; continue; }
        const index = (options.origin + written) >>> 0;
        if (!hooks.tryWriteSync(index, fastRec.value)) {
          await hooks.write(index, fastRec.value);
        }
        written++;
        continue;
      }
    }
    const allocation = hooks.allocation();
    try {
      const syncRec = options.callback === undefined && hooks.tryWriteSync
        ? input.tryMapfileRecordSync(options.delimiter, options.strip, allocation)
        : undefined;
      const record = syncRec ?? await input.mapfileRecord(options.delimiter, options.strip, allocation);
      if (!record.present) break;
      if (skipped < options.skip) { skipped++; continue; }
      const index = (options.origin + written) >>> 0;
      if (options.callback !== undefined && (written + 1) % options.quantum === 0) await hooks.callback(options.callback, index, record.value);
      if (options.callback !== undefined || !hooks.tryWriteSync?.(index, record.value)) {
        await hooks.write(index, record.value);
      }
      written++;
    } finally { allocation.close(); }
  }
}
