import { getCommandArguments, type CommandDefinition, type CommandContext } from "safe-bash-contracts";
import { argument, type Budget, command, compare, empty, encode, fail, Inputs, OrderCheck, settings, type OrderMode, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

interface Field { readonly file: number; readonly index: number }
interface Row { readonly bytes: Uint8Array; readonly fields: readonly Uint8Array[]; readonly key: Uint8Array }
interface Options {
  files: string[];
  fields: [number, number];
  unpaired: Set<number>;
  paired: boolean;
  separator: number;
  delimiter: Uint8Array | undefined;
  whole: boolean;
  utf8: boolean;
  replacement: Uint8Array;
  format: Field[] | "auto" | undefined;
  fold: boolean;
  header: boolean;
  order: OrderMode;
}

// GNU's 64-bit PTRDIFF_MAX bounds field numbers, including overflowing decimals.
const maxField = 9223372036854775807n;

function number(value: string, label: string): bigint {
  let result = 0n;
  let index = 0;
  while (index < value.length && " \t\n\r\v\f".includes(value[index]!)) index++;
  if (value[index] === "+") index++;
  for (; index < value.length; index++) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) fail(`invalid ${label}: ${value}`);
    if (result < maxField) {
      result = result * 10n + BigInt(digit);
      if (result > maxField) result = maxField;
    }
  }
  if (result === 0n) fail(`invalid ${label}: ${value}`);
  return result;
}

function parse(context: CommandContext, budget: Budget): Options {
  const options: Options = { files: [], fields: [0, 0], unpaired: new Set(), paired: true, separator: 10, delimiter: undefined, whole: false, utf8: false, replacement: empty, format: undefined, fold: false, header: false, order: "default" };
  let literal = false;
  let delimiterChoice: Uint8Array | undefined;
  const locale = (context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C").toUpperCase().split("@")[0]!;
  const utf8 = locale.endsWith("UTF-8") || locale.endsWith("UTF8");
  options.utf8 = utf8;
  const explicitFields: [bigint | undefined, bigint | undefined] = [undefined, undefined];
  let replacementSet = false;
  const fieldCandidates: ("1" | "2" | "o" | undefined)[] = [];
  const pendingFields = { "1": 0, "2": 0 };
  let nextFieldCandidate: "1" | "2" | "o" | undefined;
  const setField = (fileIndex: 0 | 1, field: bigint): void => {
    const existing = explicitFields[fileIndex];
    if (existing !== undefined && existing !== field) fail(`incompatible join fields ${existing}, ${field}`);
    explicitFields[fileIndex] = field;
    // Keep exact identity above; indices beyond JS array lengths are always absent.
    options.fields[fileIndex] = Number(field);
  };
  const apply = (flag: string, value: string, rawValue?: Uint8Array): void => {
    if (flag === "1" || flag === "2" || flag === "j") {
      const field = number(value, "field") - 1n;
      if (flag !== "2") setField(0, field);
      if (flag !== "1") setField(1, field);
    } else if (flag === "a" || flag === "v") {
      const file = number(value, "file number");
      if (file !== 1n && file !== 2n) fail(`invalid file number: ${value}`);
      options.unpaired.add(Number(file) - 1);
      if (flag === "v") options.paired = false;
    } else if (flag === "e") {
      const bytes = rawValue ?? encode(value);
      if (replacementSet && compare(options.replacement, bytes) !== 0) fail("conflicting empty-field replacement strings");
      replacementSet = true;
      options.replacement = bytes;
    }
    else if (flag === "t") {
      let bytes = value === "\\0" ? Uint8Array.of(0) : rawValue ?? encode(value);
      // GNU uses LF and the empty delimiter for whole-record matching, even with -z.
      if (bytes.length === 1 && bytes[0] === 10) bytes = empty;
      if (delimiterChoice !== undefined && compare(delimiterChoice, bytes) !== 0) fail("incompatible field delimiters");
      delimiterChoice = bytes;
      if (bytes.length > 1) {
        if (!utf8) fail("join delimiter must be one byte in the C locale");
        if (bytes.length > 4 || Array.from(value).length !== 1 || compare(encode(value), bytes) !== 0) fail("join delimiter must be one character");
      }
      options.whole = bytes.length === 0;
      options.delimiter = options.whole ? undefined : bytes;
    } else if (flag === "o") {
      if (value === "auto") {
        options.format ??= "auto";
        return;
      }
      // UTF-8 locale blanks exclude non-breaking spaces and vertical whitespace.
      const separators = utf8 ? ", \t\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200a\u205f\u3000" : ", \t";
      const values: string[] = [];
      let start = 0;
      for (let offset = 0; offset < value.length; offset++) {
        if (separators.includes(value[offset]!)) {
          values.push(value.slice(start, offset));
          start = offset + 1;
        }
      }
      values.push(value.slice(start));
      // GNU 9.10 permits one final separator, but no empty field before it.
      if (values.length > 1 && values.at(-1) === "") values.pop();
      budget.check(values.length, budget.limits.maxFields, "field");
      const fields = values.map(specification => {
        if (specification === "0") return { file: 0, index: 0 };
        const match = /^([12])\.(\+?[0-9]+)$/u.exec(specification);
        if (!match) fail(`invalid output field: ${specification}`);
        return { file: Number(match[1]), index: Number(number(match[2]!, "output field") - 1n) };
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
      // GNU defers -j1/-j2 and -o continuations until excess operands reveal them.
      if (options.files.length === 2) {
        const position = fieldCandidates.findIndex(field => field !== undefined);
        if (position < 0) fail("join requires exactly two files");
        const field = fieldCandidates[position]!;
        apply(field, options.files[position]!);
        if (field !== "o") pendingFields[field]--;
        options.files.splice(position, 1);
        fieldCandidates.splice(position, 1);
      }
      options.files.push(token);
      fieldCandidates.push(literal ? undefined : candidate);
      if (!literal && candidate === "o") nextFieldCandidate = "o";
      continue;
    }
    if (token === "--") { literal = true; continue; }
    // --h and --he are ambiguous with --help.
    if (token.length >= 5 && "--header".startsWith(token)) { options.header = true; continue; }
    if ("--check-order".startsWith(token)) { options.order = "check"; continue; }
    if ("--nocheck-order".startsWith(token)) { options.order = "none"; continue; }
    if ("--ignore-case".startsWith(token)) { options.fold = true; continue; }
    if ("--zero-terminated".startsWith(token)) { options.separator = 0; continue; }
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
        apply(flag, value, flag === "t" || flag === "e" ? getCommandArguments(context).bytes(index)!.subarray(rest ? offset + 1 : 0) : undefined);
        if (flag === "o" && value !== "auto") nextFieldCandidate = "o";
        break;
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
    const delimiter = options.delimiter;
    let start = 0;
    for (let offset = 0; offset <= bytes.length - delimiter.length; offset++) {
      if (bytes[offset] === delimiter[0] && delimiter.every((byte, index) => bytes[offset + index] === byte)) {
        add(start, offset);
        start = offset + delimiter.length;
        offset = start - 1;
      }
    }
    add(start, bytes.length);
  } else {
    const blankWidth = (offset: number): number => {
      const byte = bytes[offset];
      if (byte === 32 || byte === 9 || (options.separator === 0 && byte === 10)) return 1;
      if (!options.utf8) return 0;
      const second = bytes[offset + 1], third = bytes[offset + 2];
      // GNU UTF-8 blanks: U+1680, U+2000..U+200A except U+2007, U+205F, U+3000.
      // Match bytes directly so malformed UTF-8 in fields remains untouched.
      if (byte === 0xe1 && second === 0x9a && third === 0x80) return 3;
      if (byte === 0xe2 && ((second === 0x80 && third !== undefined && third >= 0x80 && third <= 0x8a && third !== 0x87) || (second === 0x81 && third === 0x9f))) return 3;
      if (byte === 0xe3 && second === 0x80 && third === 0x80) return 3;
      return 0;
    };
    let offset = 0;
    while (offset < bytes.length) {
      let width: number;
      while (offset < bytes.length && (width = blankWidth(offset)) > 0) offset += width;
      const start = offset;
      while (offset < bytes.length && blankWidth(offset) === 0) offset++;
      if (offset > start) add(start, offset);
    }
  }
  return fields;
}

function keyComparison(env: Readonly<Record<string, string>>): typeof compare {
  const locale = env.LC_ALL || env.LC_COLLATE || env.LANG || "C";
  if (["C", "POSIX", "C.UTF-8", "C.utf8"].includes(locale)) return compare;
  const language = locale.split(".")[0]!.split("_").join("-");
  let collator: Intl.Collator;
  try {
    if (!Intl.Collator.supportedLocalesOf([language]).length || locale.includes("@")) throw new RangeError();
    collator = new Intl.Collator(language, { usage: "sort", sensitivity: "variant", caseFirst: "lower" });
  } catch {
    fail(`unsupported collation locale '${locale}'`);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return (left, right, fold) => {
    // GNU ignore-case uses folded byte comparison, bypassing collation.
    if (fold) return compare(left, right, true);
    let first: string | undefined, second: string | undefined;
    try { first = decoder.decode(left); } catch { /* Invalid bytes follow valid text. */ }
    try { second = decoder.decode(right); } catch { /* Preserve byte ordering for invalid text. */ }
    if (first === undefined) return second === undefined ? compare(left, right) : 1;
    return second === undefined ? -1 : collator.compare(first, second);
  };
}

export function createJoinCommand(factory: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(factory);
  return command("join", limits, async (context, budget) => {
    const options = parse(context, budget);
    const compareKeys = keyComparison(context.env);
    const inputs = new Inputs(context, budget, options.separator), order = new OrderCheck(options.order, context, budget, compareKeys);
    const terminator = Uint8Array.of(options.separator), delimiter = options.delimiter ?? Uint8Array.of(32);
    try {
      const readers = [await inputs.open(options.files[0]!), await inputs.open(options.files[1]!)];
      const previous: (Uint8Array | undefined)[] = [undefined, undefined];
      let seenUnpaired = false;
      const finishRow = (bytes: Uint8Array | undefined, file: number, reset: boolean): Row | undefined | Promise<Row | undefined> => {
        if (bytes === undefined) return undefined;
        const fields = split(bytes, options, budget), key = fields[options.fields[file]!] ?? empty;
        if (!reset && (options.order !== "default" || seenUnpaired)) {
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
        const comparison = compareKeys(rows[0].key, rows[1].key, options.fold);
        if (comparison !== 0) {
          const file = comparison < 0 ? 0 : 1;
          if (options.unpaired.has(file)) await emit(file === 0 ? rows[file] : undefined, file === 1 ? rows[file] : undefined);
          { const nr = next(file); rows[file] = nr instanceof Promise ? await nr : nr; }
          // GNU starts default checking after reading past the first unpaired row.
          seenUnpaired = true;
          await order.markUnpaired();
          continue;
        }
        const key = rows[0].key, groups: Row[][] = [[], []];
        let groupBytes = 0, groupRecords = 0;
        for (let file = 0; file < 2; file++) {
          while (rows[file] && compareKeys(rows[file]!.key, key, options.fold) === 0) {
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
