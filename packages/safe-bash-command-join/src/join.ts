import { getCommandArguments, isFsError, writeBytes, type CommandDefinition, type CommandContext } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { argument, type Budget, command, compare, empty, encode, fail, Inputs, settings, type OrderMode, type RecordReader, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

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

function number(value: string): bigint {
  let result = 0n;
  let index = 0;
  while (index < value.length && " \t\n\r\v\f".includes(value[index]!)) index++;
  if (value[index] === "+") index++;
  for (; index < value.length; index++) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) throw new PublicDiagnostic(`invalid field number: '${value}'`);
    if (result < maxField) {
      result = result * 10n + BigInt(digit);
      if (result > maxField) result = maxField;
    }
  }
  if (result === 0n) throw new PublicDiagnostic(`invalid field number: '${value}'`);
  return result;
}

function parse(context: CommandContext, budget: Budget, utf8: boolean): Options {
  const options: Options = { files: [], fields: [0, 0], unpaired: new Set(), paired: true, separator: 10, delimiter: undefined, whole: false, utf8, replacement: empty, format: undefined, fold: false, header: false, order: "default" };
  const optionError = (message: string): never => {
    throw new PublicDiagnostic(`${message}\nTry 'join --help' for more information.`);
  };
  let literal = false;
  let delimiterChoice: Uint8Array | undefined;
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
      const field = number(value) - 1n;
      if (flag !== "2") setField(0, field);
      if (flag !== "1") setField(1, field);
    } else if (flag === "a" || flag === "v") {
      const file = number(value);
      if (file !== 1n && file !== 2n) throw new PublicDiagnostic(`invalid field number: '${value}'`);
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
      options.delimiter = bytes.length === 0 ? undefined : bytes;
      // GNU uses LF and the empty delimiter for whole-record matching, even with -z.
      // Retain the literal delimiter above for output.
      if (bytes.length === 1 && bytes[0] === 10) bytes = empty;
      if (delimiterChoice !== undefined && compare(delimiterChoice, bytes) !== 0) fail("incompatible field delimiters");
      delimiterChoice = bytes;
      if (bytes.length > 1) {
        if (!utf8) fail("join delimiter must be one byte in the C locale");
        if (bytes.length > 4 || Array.from(value).length !== 1 || compare(encode(value), bytes) !== 0) fail("join delimiter must be one character");
      }
      options.whole = bytes.length === 0;
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
        if ((specification[0] !== "1" && specification[0] !== "2") || specification[1] !== ".") fail(`invalid output field: ${specification}`);
        return { file: Number(specification[0]), index: Number(number(specification.slice(2)) - 1n) };
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
    if (token.startsWith("--")) {
      const name = token.split("=")[0]!;
      const matches = ["--header", "--check-order", "--nocheck-order", "--ignore-case", "--zero-terminated", "--help", "--version"].filter(option => option.startsWith(name));
      if (matches.length > 1) optionError(`option '${token}' is ambiguous; possibilities: ${matches.map(option => `'${option}'`).join(" ")}`);
      const option = matches[0];
      if (!option) optionError(`unrecognized option '${token}'`);
      if (token.includes("=")) optionError(`option '${option}' doesn't allow an argument`);
      if (option === "--header") options.header = true;
      else if (option === "--check-order") options.order = "check";
      else if (option === "--nocheck-order") options.order = "none";
      else if (option === "--ignore-case") options.fold = true;
      else if (option === "--zero-terminated") options.separator = 0;
      else fail(`unsupported option ${token}`);
      continue;
    }
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
        if (!rest && index + 1 === context.args.length) optionError(`option requires an argument -- '${flag}'`);
        let value: string;
        [value, index] = argument(context.args, index, rest || undefined, `-${flag}`);
        apply(flag, value, flag === "t" || flag === "e" ? getCommandArguments(context).bytes(index)!.subarray(rest ? offset + 1 : 0) : undefined);
        if (flag === "o" && value !== "auto") nextFieldCandidate = "o";
        break;
      } else optionError(`invalid option -- '${flag}'`);
    }
  }
  if (options.files.length !== 2) fail("join requires exactly two files");
  for (const field of ["1", "2"] as const) if (pendingFields[field]) apply("j", field);
  if (options.files.every(file => file === "-")) fail("both files cannot be standard input");
  return options;
}

function split(bytes: Uint8Array, options: Options, budget: Budget): readonly Uint8Array[] {
  if (bytes.length === 0) return [];
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

function localeSettings(env: Readonly<Record<string, string>>): { utf8: boolean; compareKeys: typeof compare } {
  // GNU initializes all locale categories together; any failure leaves them in C.
  const locales = ["LC_CTYPE", "LC_COLLATE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME",
    "LC_PAPER", "LC_NAME", "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT", "LC_IDENTIFICATION"]
    .map(category => env.LC_ALL || env[category] || env.LANG || "C");
  const byteLocales = ["C", "POSIX", "C.UTF-8", "C.utf8", "C.UTF8", "C.utf-8"];
  const ctype = locales[0]!.toUpperCase();
  const utf8 = ctype.endsWith("UTF-8") || ctype.endsWith("UTF8");
  let collator: Intl.Collator;
  try {
    for (const locale of new Set(locales)) {
      if (byteLocales.includes(locale)) continue;
      const codesetOffset = locale.indexOf(".");
      if (codesetOffset !== -1) new TextDecoder(locale.slice(codesetOffset + 1));
      const language = locale.split(".")[0]!.split("_").join("-");
      if (locale.includes("@") || !Intl.Collator.supportedLocalesOf([language]).length) throw new RangeError();
    }
    const locale = locales[1]!;
    if (byteLocales.includes(locale)) return { utf8, compareKeys: compare };
    collator = new Intl.Collator(locale.split(".")[0]!.split("_").join("-"), { usage: "sort", sensitivity: "variant", caseFirst: "lower" });
  } catch {
    return { utf8: false, compareKeys: compare };
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return { utf8, compareKeys(left, right, fold) {
    // GNU ignore-case uses folded byte comparison, bypassing collation.
    if (fold) return compare(left, right, true);
    let first: string | undefined, second: string | undefined;
    try { first = decoder.decode(left); } catch { /* Invalid bytes follow valid text. */ }
    try { second = decoder.decode(right); } catch { /* Preserve byte ordering for invalid text. */ }
    if (first === undefined) return second === undefined ? compare(left, right) : 1;
    // Unicode collation can equate distinct GNU keys; retain their original bytes.
    return second === undefined ? -1 : collator.compare(first, second) || compare(left, right);
  } };
}

export function createJoinCommand(factory: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(factory);
  return command("join", limits, async (context, budget) => {
    const { utf8, compareKeys } = localeSettings(context.env);
    const options = parse(context, budget, utf8);
    const inputs = new Inputs(context, budget, options.separator);
    const terminator = Uint8Array.of(options.separator), delimiter = options.delimiter ?? Uint8Array.of(32);
    const orderFailure = Symbol("join order failure");
    try {
      const readers: RecordReader[] = [];
      let directory = false;
      for (const file of options.files) {
        try { readers.push(await inputs.open(file)); }
        catch (error) {
          // GNU can open directories; their read error follows both operand opens.
          if (isFsError(error) && error.code === "EISDIR") directory = true;
          else if (isFsError(error) && error.code === "ENOENT") throw new PublicDiagnostic(`${file}: No such file or directory`);
          else throw error;
        }
      }
      if (directory) throw new PublicDiagnostic("read error: Is a directory");
      const previous: (Uint8Array | undefined)[] = [undefined, undefined];
      const lines = [0, 0], warned = new Set<number>();
      let seenUnpaired = false;
      const reportOrder = async (file: number, bytes: Uint8Array): Promise<void> => {
        await budget.flushOutput();
        await writeBytes(context.stderr, encode(`${context.command}: ${options.files[file]}:${lines[file]}: is not sorted: `), context.signal);
        // GNU prints records as C strings, stopping at an embedded NUL.
        const nul = bytes.indexOf(0);
        await writeBytes(context.stderr, nul < 0 ? bytes : bytes.subarray(0, nul), context.signal);
        await writeBytes(context.stderr, encode("\n"), context.signal);
        if (options.order === "check") throw orderFailure;
        warned.add(file);
      };
      const finishRow = (bytes: Uint8Array | undefined, file: number, reset: boolean): Row | undefined | Promise<Row | undefined> => {
        if (bytes === undefined) return undefined;
        lines[file]!++;
        const fields = split(bytes, options, budget), key = fields[options.fields[file]!] ?? empty;
        const prior = previous[file];
        if (!reset && options.order !== "none" && (options.order === "check" || seenUnpaired)
          && !warned.has(file) && prior !== undefined && compareKeys(prior, key, options.fold) > 0) {
          return reportOrder(file, bytes).then(() => { previous[file] = key; return { bytes, fields, key }; });
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
      if (warned.size) throw new PublicDiagnostic("input is not in sorted order");
      return { exitCode: 0 };
    } catch (error) {
      if (error !== orderFailure) throw error;
      return { exitCode: 1 };
    } finally { await inputs.close(); }
  });
}
