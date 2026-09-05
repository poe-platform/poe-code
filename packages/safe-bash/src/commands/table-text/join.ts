import type { CommandDefinition, CommandContext } from "../../contracts/index.js";
import { argument, Budget, command, compare, empty, encode, fail, Inputs, OrderCheck, requireCLocale, settings, type OrderMode, type TableTextCommandsOptions } from "./internal.js";

interface Field { readonly file: number; readonly index: number }
interface Row { readonly bytes: Uint8Array; readonly fields: readonly Uint8Array[]; readonly key: Uint8Array }
interface Options {
  files: string[];
  fields: [number, number];
  unpaired: Set<number>;
  paired: boolean;
  separator: number;
  delimiter: number | undefined;
  whole: boolean;
  replacement: Uint8Array;
  format: Field[] | "auto" | undefined;
  fold: boolean;
  header: boolean;
  order: OrderMode;
}

function number(value: string, label: string): number {
  if (!/^[0-9]+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail(`invalid ${label}: ${value}`);
  return Number(value);
}

function parse(context: CommandContext, budget: Budget): Options {
  const options: Options = { files: [], fields: [0, 0], unpaired: new Set(), paired: true, separator: 10, delimiter: undefined, whole: false, replacement: empty, format: undefined, fold: false, header: false, order: "default" };
  let literal = false;
  let delimiterChoice: number | undefined;
  const apply = (flag: string, value: string): void => {
    if (flag === "1" || flag === "2" || flag === "j") {
      const field = number(value, "field") - 1;
      if (flag !== "2") options.fields[0] = field;
      if (flag !== "1") options.fields[1] = field;
    } else if (flag === "a" || flag === "v") {
      if (value !== "1" && value !== "2") fail(`invalid file number: ${value}`);
      options.unpaired.add(Number(value) - 1);
      if (flag === "v") options.paired = false;
    } else if (flag === "e") options.replacement = encode(value);
    else if (flag === "t") {
      const bytes = encode(value);
      const choice = value === "\\0" ? 0 : bytes.length ? bytes[0]! : -1;
      if (delimiterChoice !== undefined && delimiterChoice !== choice) fail("incompatible field delimiters");
      delimiterChoice = choice;
      if (value === "\\0") { options.delimiter = 0; options.whole = false; }
      else if (!bytes.length) { options.whole = true; options.delimiter = undefined; }
      else if (bytes.length !== 1) fail("join delimiter must be one byte in the C locale");
      else { options.delimiter = bytes[0]; options.whole = false; }
    } else if (flag === "o") {
      if (value === "auto") { if (!Array.isArray(options.format)) options.format = "auto"; return; }
      const values = value.split(/[, \t]+/u);
      budget.check(values.length, budget.limits.maxFields, "field");
      const fields = values.map(specification => {
        if (specification === "0") return { file: 0, index: 0 };
        const match = /^([12])\.([0-9]+)$/u.exec(specification);
        if (!match) fail(`invalid output field: ${specification}`);
        return { file: Number(match[1]), index: number(match[2]!, "output field") - 1 };
      });
      options.format = [...(Array.isArray(options.format) ? options.format : []), ...fields];
      budget.check(options.format.length, budget.limits.maxFields, "field");
    }
  };
  for (let index = 0; index < context.args.length; index++) {
    const token = context.args[index]!;
    if (literal || token === "-" || !token.startsWith("-")) { options.files.push(token); continue; }
    if (token === "--") { literal = true; continue; }
    if (token === "--header") { options.header = true; continue; }
    if (token === "--check-order") { options.order = "check"; continue; }
    if (token === "--nocheck-order") { options.order = "none"; continue; }
    if (token === "--ignore-case") { options.fold = true; continue; }
    if (token === "--zero-terminated") { options.separator = 0; continue; }
    if (token.startsWith("--")) fail(`unsupported option ${token}`);
    for (let offset = 1; offset < token.length; offset++) {
      const flag = token[offset]!;
      if (flag === "i") options.fold = true;
      else if (flag === "z") options.separator = 0;
      else if ("12jaevto".includes(flag)) {
        let value: string;
        [value, index] = argument(context.args, index, token.slice(offset + 1) || undefined, `-${flag}`);
        apply(flag, value); break;
      } else fail(`unsupported option -${flag}`);
    }
  }
  if (options.files.length !== 2) fail("join requires exactly two files");
  if (options.files.every(file => file === "-")) fail("both files cannot be standard input");
  return options;
}

function split(bytes: Uint8Array, options: Options, budget: Budget): readonly Uint8Array[] {
  if (options.whole) return [bytes];
  const fields: Uint8Array[] = [];
  const add = (start: number, end: number): void => {
    budget.check(fields.length + 1, budget.limits.maxFields, "field");
    fields.push(bytes.subarray(start, end));
  };
  if (options.delimiter !== undefined) {
    let start = 0;
    for (let offset = 0; offset < bytes.length; offset++) if (bytes[offset] === options.delimiter) { add(start, offset); start = offset + 1; }
    add(start, bytes.length);
  } else {
    const blank = (byte: number): boolean => byte === 32 || byte === 9 || (options.separator === 0 && byte === 10);
    let offset = 0;
    while (offset < bytes.length) {
      while (offset < bytes.length && blank(bytes[offset]!)) offset++;
      const start = offset;
      while (offset < bytes.length && !blank(bytes[offset]!)) offset++;
      if (offset > start) add(start, offset);
    }
  }
  return fields;
}

export function createJoinCommand(factory: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(factory);
  return command("join", async context => {
    const budget = new Budget(context, limits), options = parse(context, budget);
    requireCLocale(context);
    const inputs = new Inputs(context, budget, options.separator), order = new OrderCheck(options.order, context);
    const terminator = Uint8Array.of(options.separator), delimiter = Uint8Array.of(options.delimiter ?? 32);
    try {
      const readers = [await inputs.open(options.files[0]!), await inputs.open(options.files[1]!)];
      const previous: (Uint8Array | undefined)[] = [undefined, undefined];
      const next = async (file: number, reset = false): Promise<Row | undefined> => {
        const bytes = await readers[file]!.next();
        if (bytes === undefined) return undefined;
        const fields = split(bytes, options, budget), key = fields[options.fields[file]!] ?? empty;
        if (!reset) await order.check(previous[file], key, file + 1, options.fold);
        previous[file] = key;
        return { bytes, fields, key };
      };
      const rows = [await next(0), await next(1)];
      const counts = rows.map(row => row?.fields.length ?? 0);
      const emit = async (left: Row | undefined, right: Row | undefined): Promise<void> => {
        const pair = [left, right], fields: Uint8Array[] = [];
        const key = (left ?? right)?.key ?? empty;
        if (Array.isArray(options.format)) {
          for (const field of options.format) {
            await budget.step();
            fields.push(field.file === 0 ? key : pair[field.file - 1]?.fields[field.index] ?? empty);
          }
        } else {
          fields.push(key);
          for (let file = 0; file < 2; file++) {
            const count = options.format === "auto" ? counts[file]! : pair[file]?.fields.length ?? 0;
            for (let index = 0; index < count; index++) {
              await budget.step();
              if (index !== options.fields[file]) fields.push(pair[file]?.fields[index] ?? empty);
            }
          }
        }
        const parts: Uint8Array[] = [];
        for (let index = 0; index < fields.length; index++) {
          await budget.step();
          if (index) parts.push(delimiter);
          parts.push(fields[index]!.length ? fields[index]! : options.replacement);
        }
        parts.push(terminator); await budget.output(parts);
      };
      if (options.header && (rows[0] || rows[1])) {
        await emit(rows[0], rows[1]);
        for (let file = 0; file < 2; file++) if (rows[file]) rows[file] = await next(file, true);
      }
      while (rows[0] && rows[1]) {
        await budget.step();
        const comparison = compare(rows[0].key, rows[1].key, options.fold);
        if (comparison !== 0) {
          const file = comparison < 0 ? 0 : 1;
          if (options.unpaired.has(file)) await emit(file === 0 ? rows[file] : undefined, file === 1 ? rows[file] : undefined);
          rows[file] = await next(file); order.unpaired = true;
          continue;
        }
        const key = rows[0].key, groups: Row[][] = [[], []];
        let groupBytes = 0, groupRecords = 0;
        for (let file = 0; file < 2; file++) {
          while (rows[file] && compare(rows[file]!.key, key, options.fold) === 0) {
            const row = rows[file]!;
            groupBytes += row.bytes.length;
            budget.check(groupBytes, limits.maxGroupBytes, "join group byte");
            budget.check(++groupRecords, limits.maxGroupRecords, "join group record");
            groups[file]!.push(row); rows[file] = await next(file);
          }
        }
        if (options.paired) for (const left of groups[0]!) for (const right of groups[1]!) await emit(left, right);
      }
      for (let file = 0; file < 2; file++) {
        if (!options.unpaired.has(file) && options.order === "none") continue;
        while (rows[file]) {
          if (options.unpaired.has(file)) await emit(file === 0 ? rows[file] : undefined, file === 1 ? rows[file] : undefined);
          rows[file] = await next(file);
        }
      }
      return { exitCode: order.failed ? 1 : 0 };
    } finally { await inputs.close(); }
  });
}
