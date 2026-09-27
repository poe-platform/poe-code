import type { CommandDefinition, CommandContext } from "../../contracts/index.js";
import { argument, Budget, command, compare, empty, encode, fail, Inputs, OrderCheck, settings, type OrderMode, type TableTextCommandsOptions } from "./internal.js";

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
  if (!/^\+?[0-9]+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail(`invalid ${label}: ${value}`);
  return Number(value);
}

function parse(context: CommandContext, budget: Budget): Options {
  const options: Options = { files: [], fields: [0, 0], unpaired: new Set(), paired: true, separator: 10, delimiter: undefined, whole: false, replacement: empty, format: undefined, fold: false, header: false, order: "default" };
  let literal = false;
  let delimiterChoice: number | undefined;
  const explicitFields: [number | undefined, number | undefined] = [undefined, undefined];
  let explicitReplacement: string | undefined;
  const fieldCandidates: ("1" | "2" | undefined)[] = [];
  const pendingFields = { "1": 0, "2": 0 };
  let nextFieldCandidate: "1" | "2" | undefined;
  const setField = (fileIndex: 0 | 1, field: number): void => {
    const existing = explicitFields[fileIndex];
    if (existing !== undefined && existing !== field) fail(`incompatible join fields ${existing}, ${field}`);
    explicitFields[fileIndex] = field;
    options.fields[fileIndex] = field;
  };
  const apply = (flag: string, value: string): void => {
    if (flag === "1" || flag === "2" || flag === "j") {
      const field = number(value, "field") - 1;
      if (flag !== "2") setField(0, field);
      if (flag !== "1") setField(1, field);
    } else if (flag === "a" || flag === "v") {
      if (value !== "1" && value !== "2") fail(`invalid file number: ${value}`);
      options.unpaired.add(Number(value) - 1);
      if (flag === "v") options.paired = false;
    } else if (flag === "e") {
      if (explicitReplacement !== undefined && explicitReplacement !== value) fail("conflicting empty-field replacement strings");
      explicitReplacement = value;
      options.replacement = encode(value);
    }
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
      if (value === "auto") {
        if (Array.isArray(options.format)) fail("conflicting output format specifications");
        options.format = "auto";
        return;
      }
      if (options.format === "auto") fail("conflicting output format specifications");
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
    const candidate = nextFieldCandidate;
    nextFieldCandidate = undefined;
    if (literal || token === "-" || !token.startsWith("-")) {
      // GNU defers -j1/-j2 until excess operands reveal a separate field.
      if (options.files.length === 2) {
        const position = fieldCandidates.findIndex(field => field !== undefined);
        if (position < 0) fail("join requires exactly two files");
        const field = fieldCandidates[position]!;
        apply(field, options.files[position]!);
        pendingFields[field]--;
        options.files.splice(position, 1);
        fieldCandidates.splice(position, 1);
      }
      options.files.push(token);
      fieldCandidates.push(literal ? undefined : candidate);
      continue;
    }
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
        const rest = token.slice(offset + 1);
        if (token === `-j${rest}` && (rest === "1" || rest === "2")) {
          pendingFields[rest]++;
          nextFieldCandidate = rest;
          break;
        }
        let value: string;
        [value, index] = argument(context.args, index, rest || undefined, `-${flag}`);
        apply(flag, value); break;
      } else fail(`unsupported option -${flag}`);
    }
  }
  if (options.files.length !== 2) fail("join requires exactly two files");
  for (const field of ["1", "2"] as const) if (pendingFields[field]) apply("j", field);
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
    // GNU join keeps a final empty field after blanks in a NUL-delimited record.
    if (options.separator === 0 && fields.length && blank(bytes[bytes.length - 1]!)) add(bytes.length, bytes.length);
  }
  return fields;
}

export function createJoinCommand(factory: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(factory);
  return command("join", async context => {
    const budget = new Budget(context, limits), options = parse(context, budget);
    const inputs = new Inputs(context, budget, options.separator), order = new OrderCheck(options.order, context);
    const terminator = Uint8Array.of(options.separator), delimiter = Uint8Array.of(options.delimiter ?? 32);
    try {
      const readers = [await inputs.open(options.files[0]!), await inputs.open(options.files[1]!)];
      const previous: (Uint8Array | undefined)[] = [undefined, undefined];
      const finishRow = (bytes: Uint8Array | undefined, file: number, reset: boolean): Row | undefined | Promise<Row | undefined> => {
        if (bytes === undefined) return undefined;
        const fields = split(bytes, options, budget), key = fields[options.fields[file]!] ?? empty;
        if (!reset) {
          const oc = order.check(previous[file], key, file + 1, options.fold);
          if (oc) return oc.then(() => { previous[file] = key; return { bytes, fields, key }; });
        }
        previous[file] = key;
        return { bytes, fields, key };
      };
      const next = (file: number, reset = false): Row | undefined | Promise<Row | undefined> => {
        const b = readers[file]!.next();
        if (b instanceof Promise) return b.then(bytes => finishRow(bytes, file, reset));
        return finishRow(b, file, reset);
      };
      const r0 = next(0);
      const row0 = r0 instanceof Promise ? await r0 : r0;
      const r1 = next(1);
      const row1 = r1 instanceof Promise ? await r1 : r1;
      const rows: (Row | undefined)[] = [row0, row1];
      const counts = rows.map(row => row?.fields.length ?? 0);
      const outputPartsSlow = async (left: Row | undefined, right: Row | undefined): Promise<Uint8Array[]> => {
        const pair = [left, right], fields: Uint8Array[] = [];
        const key = (left ?? right)?.key ?? empty;
        if (Array.isArray(options.format)) {
          for (const field of options.format) {
            { const step = budget.step(); if (step) await step; }
            fields.push(field.file === 0 ? key : pair[field.file - 1]?.fields[field.index] ?? empty);
          }
        } else {
          fields.push(key);
          for (let file = 0; file < 2; file++) {
            const count = options.format === "auto" ? counts[file]! : pair[file]?.fields.length ?? 0;
            for (let index = 0; index < count; index++) {
              { const step = budget.step(); if (step) await step; }
              if (index !== options.fields[file]) fields.push(pair[file]?.fields[index] ?? empty);
            }
          }
        }
        const parts: Uint8Array[] = [];
        for (let index = 0; index < fields.length; index++) {
          { const step = budget.step(); if (step) await step; }
          if (index) parts.push(delimiter);
          parts.push(fields[index]!.length ? fields[index]! : options.replacement);
        }
        parts.push(terminator); return parts;
      };
      const outputParts = (left: Row | undefined, right: Row | undefined): Uint8Array[] | Promise<Uint8Array[]> => {
        if (!Array.isArray(options.format)) {
          const c0 = options.format === "auto" ? counts[0]! : left?.fields.length ?? 0;
          const c1 = options.format === "auto" ? counts[1]! : right?.fields.length ?? 0;
          const totalSteps = (c0 + c1) * 2 + 2;
          if ((budget.steps % 1024) + totalSteps < 1024) {
            const key = (left ?? right)?.key ?? empty;
            const parts: Uint8Array[] = [key.length ? key : options.replacement];
            budget.step();
            const f0 = options.fields[0];
            for (let index = 0; index < c0; index++) {
              budget.step();
              if (index !== f0) {
                budget.step();
                const val = left?.fields[index] ?? empty;
                parts.push(delimiter, val.length ? val : options.replacement);
              }
            }
            const f1 = options.fields[1];
            for (let index = 0; index < c1; index++) {
              budget.step();
              if (index !== f1) {
                budget.step();
                const val = right?.fields[index] ?? empty;
                parts.push(delimiter, val.length ? val : options.replacement);
              }
            }
            parts.push(terminator);
            return parts;
          }
        }
        return outputPartsSlow(left, right);
      };
      const emit = (left: Row | undefined, right: Row | undefined): void | Promise<void> => {
        const parts = outputParts(left, right);
        if (parts instanceof Promise) return parts.then(p => budget.output(p));
        return budget.output(parts);
      };
      if (options.header && (rows[0] || rows[1])) {
        await emit(rows[0], rows[1]);
        for (let file = 0; file < 2; file++) if (rows[file]) rows[file] = await next(file, true);
      }
      while (rows[0] && rows[1]) {
        { const step = budget.step(); if (step) await step; }
        const comparison = compare(rows[0].key, rows[1].key, options.fold);
        if (comparison !== 0) {
          const file = comparison < 0 ? 0 : 1;
          if (options.unpaired.has(file)) await emit(file === 0 ? rows[file] : undefined, file === 1 ? rows[file] : undefined);
          { const nr = next(file); rows[file] = nr instanceof Promise ? await nr : nr; } order.unpaired = true;
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
            groups[file]!.push(row); { const nr = next(file); rows[file] = nr instanceof Promise ? await nr : nr; }
          }
        }
        if (options.paired) {
          if (Number.isFinite(limits.maxOutputBytes)) {
            // Output size is separable by operand, including explicit formats,
            // replacement fields and the left operand's case-preserved key.
            // BigInt keeps admission exact even for a huge Cartesian product.
            const size = async (left: Row, right: Row): Promise<bigint> =>
              BigInt((await outputParts(left, right)).reduce((total, part) => total + part.length, 0));
            const firstLeft = groups[0]![0]!, firstRight = groups[1]![0]!;
            const baseline = await size(firstLeft, firstRight);
            let leftBytes = 0n, rightDifference = 0n;
            for (const left of groups[0]!) leftBytes += await size(left, firstRight);
            for (const right of groups[1]!) rightDifference += await size(firstLeft, right) - baseline;
            budget.admitOutput(leftBytes * BigInt(groups[1]!.length) + rightDifference * BigInt(groups[0]!.length));
          }
          for (const left of groups[0]!) for (const right of groups[1]!) { const ep = emit(left, right); if (ep) await ep; }
        }
      }
      for (let file = 0; file < 2; file++) {
        if (!options.unpaired.has(file) && options.order === "none") continue;
        while (rows[file]) {
          if (options.unpaired.has(file)) await emit(file === 0 ? rows[file] : undefined, file === 1 ? rows[file] : undefined);
          rows[file] = await next(file);
        }
      }
      await order.finish();
      return { exitCode: order.failed ? 1 : 0 };
    } finally { await inputs.close(); }
  });
}
