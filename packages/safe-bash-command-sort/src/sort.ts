import { compareByteArrays, decodeBytes, encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { createBufferedOutput, type ByteSource, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { assertInputRequirements, define, diagnostic, encoder, input, integer, options, pathOf, UsageError, value } from "safe-bash-io-engine/internal";
import { assertCommandRequirements } from "safe-bash-contracts/command-requirements";
import { textOutputRequirements } from "safe-bash-io-engine/portable-requirements";
import { runYieldCheckpoint } from "safe-bash-contracts/yield";
import { openFileOutput } from "safe-bash-contracts/filesystem-output";
import { SortWork } from "./work.js";
import { SortRecord, SortStorage, readRecords } from "./records.js";
import { SortRuns } from "./runs.js";
import { mergeRecords } from "./merge.js";
import { resolveSortLimits, type SortCommandsOptions } from "./options.js";
import { compareLargeKeys } from "./record-compare.js";

function sortCollator(env: Readonly<Record<string, string>>): Intl.Collator | undefined {
  const locale = env.LC_ALL || env.LC_COLLATE || env.LANG || "C";
  if (["C", "POSIX", "C.UTF-8", "C.utf8"].includes(locale)) return undefined;
  const language = locale.split(".")[0]!.split("_").join("-");
  try {
    if (!Intl.Collator.supportedLocalesOf([language]).length || locale.includes("@")) throw new RangeError();
    return new Intl.Collator(language, { usage: "sort", sensitivity: "variant", caseFirst: "lower" });
  } catch {
    throw new UsageError(`unsupported collation locale '${locale}'`);
  }
}

async function resolveAfterCheckpoint(checkpoint: Promise<void>, value: number): Promise<number> {
  await checkpoint;
  return value;
}

async function compareSortBytesLargeAsync(left: Uint8Array, right: Uint8Array, length: number, work: SortWork): Promise<number> {
  for (let offset = 0; offset < length; offset += 1024) {
    const end = Math.min(offset + 1024, length);
    const checkpoint = work.charge(2 * (end - offset));
    if (checkpoint) await checkpoint;
    const compared = compareByteArrays(left.subarray(offset, end), right.subarray(offset, end));
    if (compared) return compared;
  }
  return left.length - right.length;
}

function compareSortBytes(left: Uint8Array, right: Uint8Array, work: SortWork): number | Promise<number> {
  const length = Math.min(left.length, right.length);
  if (length <= 1024) {
    const checkpoint = work.charge(2 * length);
    let order = 0;
    for (let i = 0; i < length; i++) {
      const diff = left[i]! - right[i]!;
      if (diff !== 0) { order = diff; break; }
    }
    if (order === 0) order = left.length - right.length;
    return checkpoint ? resolveAfterCheckpoint(checkpoint, order) : order;
  }
  return compareSortBytesLargeAsync(left, right, length, work);
}

async function foldSortBytes(bytes: Uint8Array, work: SortWork): Promise<Uint8Array> {
  const folded = new Uint8Array(bytes.length);
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    const end = Math.min(offset + 1024, bytes.length);
    await work.charge(end - offset);
    for (let index = offset; index < end; index++) {
      const byte = bytes[index]!;
      folded[index] = byte >= 97 && byte <= 122 ? byte - 32 : byte;
    }
  }
  return folded;
}

async function admitTextOutput(context: CommandContext, destination: string | undefined): Promise<void> {
  if (destination === undefined) return;
  assertCommandRequirements(context, textOutputRequirements, ["output"]);
  if (context.fs.capabilitiesFor) assertCommandRequirements(context, textOutputRequirements, ["output"],
    await context.fs.capabilitiesFor(pathOf(context, destination), { signal: context.signal }));
}

interface NumericValue { whole: string; fraction: string; negative: boolean; suffixRank: number }
const cachedSmallNumericValues: (NumericValue | undefined)[] = new Array(1000);
const ZERO_NUMERIC_VALUE: NumericValue = { whole: "0", fraction: "", negative: false, suffixRank: 0 };

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  const len = end - start;
  if (len <= 0) return "";
  if (len === 1) return String.fromCharCode(bytes[start]!);
  if (len === 2) return String.fromCharCode(bytes[start]!, bytes[start + 1]!);
  if (len === 3) return String.fromCharCode(bytes[start]!, bytes[start + 1]!, bytes[start + 2]!);
  if (len === 4) return String.fromCharCode(bytes[start]!, bytes[start + 1]!, bytes[start + 2]!, bytes[start + 3]!);
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

function parseNumericSync(bytes: Uint8Array, human = false): NumericValue {
  return parseNumericRangeSync(bytes, 0, bytes.length, human);
}

function parseNumericRangeSync(bytes: Uint8Array, startOffset: number, endOffset: number, human = false): NumericValue {
  const len = endOffset;
  let i = startOffset;
  while (i < len && (bytes[i] === 32 || bytes[i] === 9)) i++;
  let neg = false;
  if (i < len && bytes[i] === 45) { neg = true; i++; }
  let wholeStart = i;
  while (wholeStart < len && bytes[wholeStart] === 48) wholeStart++;
  let wholeEnd = wholeStart;
  while (wholeEnd < len && bytes[wholeEnd]! >= 48 && bytes[wholeEnd]! <= 57) wholeEnd++;
  i = wholeEnd;
  let fracStart = 0;
  let fracEnd = 0;
  if (i < len && bytes[i] === 46) {
    i++;
    fracStart = i;
    while (i < len && bytes[i]! >= 48 && bytes[i]! <= 57) i++;
    fracEnd = i;
    while (fracEnd > fracStart && bytes[fracEnd - 1] === 48) fracEnd--;
  }
  const wholeLen = wholeEnd - wholeStart;
  if (fracEnd === fracStart && (!human || (bytes[i] === undefined))) {
    if (wholeLen === 0) return ZERO_NUMERIC_VALUE;
    if (!neg && wholeLen <= 3) {
      let num = bytes[wholeStart]! - 48;
      if (wholeLen >= 2) num = num * 10 + (bytes[wholeStart + 1]! - 48);
      if (wholeLen === 3) num = num * 10 + (bytes[wholeStart + 2]! - 48);
      return (cachedSmallNumericValues[num] ??= { whole: String(num), fraction: "", negative: false, suffixRank: 0 });
    }
  }
  const whole = wholeEnd > wholeStart ? asciiSlice(bytes, wholeStart, wholeEnd) : "0";
  const fraction = fracEnd > fracStart ? asciiSlice(bytes, fracStart, fracEnd) : "";
  const nonzero = whole !== "0" || fraction !== "";
  const suffix = bytes[i];
  const suffixRank = human && nonzero ? "KMGTPEZYRQ".indexOf(String.fromCharCode(suffix === 107 ? 75 : suffix ?? 0)) + 1 : 0;
  return { whole, fraction, negative: neg && nonzero, suffixRank };
}

function parseNumeric(bytes: Uint8Array, work: SortWork, human = false): NumericValue | Promise<NumericValue> {
  const checkpoint = work.charge(bytes.length);
  return checkpoint ? checkpoint.then(() => parseNumericSync(bytes, human)) : parseNumericSync(bytes, human);
}

async function compareNumericValuesLargeAsync(first: NumericValue, second: NumericValue, work: SortWork): Promise<number> {
  let compared = 0;
  for (let offset = 0; offset < first.whole.length && !compared; offset += 1024) {
    const end = Math.min(offset + 1024, first.whole.length);
    const checkpoint = work.charge(2 * (end - offset));
    if (checkpoint) await checkpoint;
    const firstWhole = first.whole.slice(offset, end);
    const secondWhole = second.whole.slice(offset, end);
    compared = firstWhole < secondWhole ? -1 : firstWhole > secondWhole ? 1 : 0;
  }
  if (!compared) {
    const width = Math.max(first.fraction.length, second.fraction.length);
    for (let offset = 0; offset < width && !compared; offset += 1024) {
      const end = Math.min(offset + 1024, width);
      const checkpoint = work.charge(2 * (end - offset));
      if (checkpoint) await checkpoint;
      const firstFraction = first.fraction.slice(offset, end).padEnd(end - offset, "0");
      const secondFraction = second.fraction.slice(offset, end).padEnd(end - offset, "0");
      compared = firstFraction < secondFraction ? -1 : firstFraction > secondFraction ? 1 : 0;
    }
  }
  return first.negative ? -compared : compared;
}

function compareNumericValues(first: NumericValue, second: NumericValue, work: SortWork): number | Promise<number> {
  if (first.negative !== second.negative) return first.negative ? -1 : 1;
  let compared = first.suffixRank - second.suffixRank;
  if (!compared) compared = first.whole.length - second.whole.length;
  if (compared) return first.negative ? -compared : compared;
  if (first.whole.length <= 1024 && Math.max(first.fraction.length, second.fraction.length) <= 1024) {
    let charge = 2 * first.whole.length;
    compared = first.whole < second.whole ? -1 : first.whole > second.whole ? 1 : 0;
    if (!compared) {
      const width = Math.max(first.fraction.length, second.fraction.length);
      if (width > 0) {
        charge += 2 * width;
        const firstFraction = first.fraction.padEnd(width, "0");
        const secondFraction = second.fraction.padEnd(width, "0");
        compared = firstFraction < secondFraction ? -1 : firstFraction > secondFraction ? 1 : 0;
      }
    }
    const result = first.negative ? -compared : compared;
    const checkpoint = charge > 0 ? work.charge(charge) : undefined;
    return checkpoint ? resolveAfterCheckpoint(checkpoint, result) : result;
  }
  return compareNumericValuesLargeAsync(first, second, work);
}

export interface SortKey { start: number; startCharacter: number; startBlanks: boolean; endBlanks: boolean; end?: number; endCharacter?: number; flags: Set<string> }

function sortKey(specification: string): SortKey {
  let offset = 0;
  const position = (minimum: number) => {
    const begin = offset;
    while (specification[offset] !== undefined && "0123456789".includes(specification[offset]!)) offset++;
    if (offset === begin) throw new UsageError(`invalid key '${specification}'`);
    return integer(specification.slice(begin, offset), minimum);
  };
  const flags = new Set<string>();
  const endpoint = (minimumCharacter: number) => {
    const field = position(1);
    let character: number | undefined;
    let blanks = false;
    if (specification[offset] === ".") { offset++; character = position(minimumCharacter); }
    while (specification[offset] !== undefined && "bdfghiMnrV".includes(specification[offset]!)) {
      const flag = specification[offset++]!;
      flags.add(flag);
      if (flag === "b") blanks = true;
    }
    return { field, character, blanks };
  };
  const start = endpoint(1);
  let end: ReturnType<typeof endpoint> | undefined;
  if (specification[offset] === ",") { offset++; end = endpoint(0); }
  if (offset !== specification.length) throw new UsageError(`invalid key '${specification}'`);
  return {
    start: start.field, startCharacter: start.character ?? 1,
    startBlanks: start.blanks, endBlanks: end?.blanks ?? false,
    ...(end === undefined ? {} : { end: end.field }),
    ...(end?.character === undefined || end.character === 0 ? {} : { endCharacter: end.character }), flags,
  };
}

async function filterSortBytes(bytes: Uint8Array, dictionary: boolean, work: SortWork): Promise<Uint8Array> {
  const filtered = new Uint8Array(bytes.length);
  let size = 0;
  for (let index = 0; index < bytes.length; index++) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    const byte = bytes[index]!;
    if (dictionary ? byte === 9 || byte === 32 || byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 : byte >= 32 && byte <= 126) filtered[size++] = byte;
  }
  return filtered.subarray(0, size);
}

async function generalNumericValue(bytes: Uint8Array, work: SortWork): Promise<{ rank: number; value: number }> {
  await work.charge(bytes.length);
  let start = 0;
  while (bytes[start] === 32 || bytes[start] !== undefined && bytes[start]! >= 9 && bytes[start]! <= 13) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    start++;
  }
  const text = decodeBytes(encodeBytes(bytes.subarray(start)), "latin1");
  const lower = text.toLowerCase();
  const unsigned = lower[0] === "+" || lower[0] === "-" ? lower.slice(1) : lower;
  if (unsigned.startsWith("nan")) return { rank: 1, value: 0 };
  if (unsigned.startsWith("inf")) return { rank: 2, value: lower[0] === "-" ? -Infinity : Infinity };
  if (unsigned.startsWith("0x")) {
    let offset = 2, value = 0, scale = 1, fractional = false, digits = 0;
    while (offset < unsigned.length) {
      const checkpoint = work.charge();
      if (checkpoint) await checkpoint;
      const character = unsigned[offset]!;
      if (character === "." && !fractional) { fractional = true; offset++; continue; }
      const digit = "0123456789abcdef".indexOf(character);
      if (digit < 0) break;
      digits++;
      if (fractional) { scale /= 16; value += digit * scale; }
      else value = value * 16 + digit;
      offset++;
    }
    if (digits) {
      if (unsigned[offset] === "p") {
        const exponent = Number.parseInt(unsigned.slice(offset + 1), 10);
        if (!Number.isNaN(exponent) && value !== 0) value *= 2 ** exponent;
      }
      return { rank: 2, value: lower[0] === "-" ? -value : value };
    }
  }
  const value = Number.parseFloat(text);
  return { rank: Number.isNaN(value) ? 0 : 2, value: Number.isNaN(value) ? 0 : value };
}

async function monthValue(bytes: Uint8Array, work: SortWork): Promise<number> {
  let offset = 0;
  while (bytes[offset] === 9 || bytes[offset] === 32) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    offset++;
  }
  const name = decodeBytes(encodeBytes(bytes.subarray(offset, offset + 3)), "latin1").toUpperCase();
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(name) + 1;
}

function versionOrder(byte: number | undefined): number {
  if (byte === 126) return -1;
  if (byte === undefined || byte >= 48 && byte <= 57) return 0;
  return byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 ? byte : byte + 256;
}

async function compareVersionParts(left: Uint8Array, right: Uint8Array, work: SortWork): Promise<number> {
  let first = 0, second = 0;
  const digit = (byte: number | undefined) => byte !== undefined && byte >= 48 && byte <= 57;
  while (first < left.length || second < right.length) {
    while (first < left.length && !digit(left[first]) || second < right.length && !digit(right[second])) {
      const checkpoint = work.charge(2);
      if (checkpoint) await checkpoint;
      const result = versionOrder(left[first]) - versionOrder(right[second]);
      if (result) return result;
      if (first < left.length) first++;
      if (second < right.length) second++;
    }
    while (left[first] === 48) { await work.charge(); first++; }
    while (right[second] === 48) { await work.charge(); second++; }
    let difference = 0;
    while (digit(left[first]) && digit(right[second])) {
      const checkpoint = work.charge(2);
      if (checkpoint) await checkpoint;
      difference ||= left[first]! - right[second]!;
      first++; second++;
    }
    if (digit(left[first])) return 1;
    if (digit(right[second])) return -1;
    if (difference) return difference;
  }
  return 0;
}

async function versionPrefix(bytes: Uint8Array, work: SortWork): Promise<Uint8Array> {
  let match = bytes.length;
  let readAlpha = false;
  for (let index = bytes[0] === 46 ? 1 : 0; index < bytes.length; index++) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    const byte = bytes[index]!;
    const alpha = byte === 126 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
    if (readAlpha) {
      readAlpha = false;
      if (!alpha) match = bytes.length;
    } else if (byte === 46) {
      readAlpha = true;
      if (match === bytes.length) match = index;
    } else if (!(alpha || byte >= 48 && byte <= 57)) {
      match = bytes.length;
    }
  }
  return bytes.subarray(0, readAlpha ? bytes.length : match);
}

async function compareVersions(left: Uint8Array, right: Uint8Array, work: SortWork): Promise<number> {
  const special = (bytes: Uint8Array) => !bytes.length ? 0 : bytes[0] !== 46 ? 4 : bytes.length === 1 ? 1 : bytes.length === 2 && bytes[1] === 46 ? 2 : 3;
  const result = special(left) - special(right);
  if (result) return result;
  return await compareVersionParts(await versionPrefix(left, work), await versionPrefix(right, work), work) || await compareVersionParts(left, right, work);
}

const SORT_LONG_OPTIONS = Object.freeze({
  "human-numeric-sort": "h",
  "numeric-sort": "n",
  "general-numeric-sort": "g",
  "month-sort": "M",
  "version-sort": "V",
  "dictionary-order": "d",
  "ignore-nonprinting": "i",
  merge: "m",
  sort: "mode:",
  "buffer-size": "S",
  "max-input-bytes": "max-input-bytes:",
  "max-records": "max-records:",
  "batch-size": "batch-size:",
  reverse: "r",
  "ignore-case": "f",
  "ignore-leading-blanks": "b",
  unique: "u",
  stable: "s",
  "zero-terminated": "z",
  "field-separator": "t",
  key: "k",
  output: "o",
  check: "c",
});
const SORT_MODE_FLAGS: Readonly<Record<string, string>> = Object.freeze({
  numeric: "n",
  "general-numeric": "g",
  "human-numeric": "h",
  month: "M",
  version: "V",
});

async function keyBytes(line: Uint8Array, key: SortKey, separator: number | undefined, blanks: boolean, work: SortWork): Promise<Uint8Array> {
  const fields: { start: number; end: number }[] = [];
  if (separator !== undefined) {
    let start = 0;
    for (let offset = 0; offset <= line.length; offset++) {
      if (offset > 0 && offset % 1024 === 0) await work.charge(1024);
      if (offset === line.length || line[offset] === separator) {
        fields.push({ start, end: offset }); start = offset + 1;
      }
    }
  } else {
    let offset = 0;
    while (offset < line.length) {
      const leading = offset;
      while (offset < line.length && (line[offset] === 32 || line[offset] === 9)) {
        if (++offset % 1024 === 0) await work.charge(1024);
      }
      const start = leading;
      while (offset < line.length && line[offset] !== 32 && line[offset] !== 9) {
        if (++offset % 1024 === 0) await work.charge(1024);
      }
      fields.push({ start, end: offset });
    }
  }
  await work.charge(line.length % 1024);
  const fieldStart = async (field: { start: number; end: number } | undefined, skipBlanks: boolean) => {
    let offset = field?.start ?? line.length;
    if (skipBlanks) while (offset < (field?.end ?? line.length) && (line[offset] === 32 || line[offset] === 9)) {
      const checkpoint = work.charge();
      if (checkpoint) await checkpoint;
      offset++;
    }
    return offset;
  };
  const inheritBlanks = key.flags.size === 0 && blanks;
  const start = await fieldStart(fields[key.start - 1], key.startBlanks || inheritBlanks) + key.startCharacter - 1;
  const last = key.end === undefined ? undefined : fields[key.end - 1];
  // Explicit character positions can extend beyond a field, up to the record boundary.
  const end = key.end === undefined ? line.length : last === undefined ? line.length
    : key.endCharacter === undefined ? last.end : Math.min(line.length, await fieldStart(last, key.endBlanks || inheritBlanks) + key.endCharacter);
  return line.subarray(Math.min(start, line.length), Math.max(start, end));
}

const recordSeparators = { 0: Uint8Array.of(0), 10: Uint8Array.of(10) };

async function emitRecords(context: CommandContext, records: ByteSource, destination?: string, incremental = false): Promise<void> {
  if (destination === undefined) {
    const buffered = createBufferedOutput(context.stdout, context.signal);
    for await (const bytes of records) {
      await buffered.write(bytes);
      if (incremental) await buffered.flush();
    }
    await buffered.flush();
    return;
  }
  void context.registerCleanup;
  await admitTextOutput(context, destination);
  const capabilities = await context.fs.capabilitiesFor?.(pathOf(context, destination), { signal: context.signal }) ?? context.fs.capabilities;
  const descriptor = (!context.fs.writeStream || capabilities.streamingWrite === false) && context.fs.open !== undefined && capabilities.open !== false;
  const destinationOutput = await openFileOutput(context, pathOf(context, destination), { flag: "w", descriptor });
  try {
    for await (const bytes of records) await destinationOutput.sink.write(bytes);
    await destinationOutput.finish();
  } catch (error) {
    await destinationOutput.abort(error);
    throw error;
  }
}

async function executeSort(context: CommandContext, settings: SortCommandsOptions): Promise<{ exitCode: number }> {
  let ended = false;
  let hasCheckLong = false;
  for (let i = 0; i < context.args.length; i++) {
    const a = context.args[i]!;
    if (a === "--") break;
    if (a.startsWith("--check")) { hasCheckLong = true; break; }
  }
  const args = hasCheckLong
    ? context.args.map(argument => {
        if (ended) return argument;
        if (argument === "--") ended = true;
        if (argument === "--check" || argument === "--check=diagnose-first") return "-c";
        if (argument === "--check=quiet" || argument === "--check=silent") return "-C";
        if (argument.startsWith("--check=")) throw new UsageError(`invalid argument '${argument.slice(8)}' for '--check'`);
        return argument;
      })
    : context.args;
  const parsed = options(args, "hngMVdimrfbuszt:k:o:cCS:", SORT_LONG_OPTIONS);
  if (parsed.flags.has("c") && parsed.flags.has("C")) throw new UsageError("options '-cC' are incompatible");
  const checking = parsed.flags.has("c") || parsed.flags.has("C");
  if (checking && parsed.operands.length > 1) throw new UsageError(`extra operand '${parsed.operands[1]}' not allowed with -${parsed.flags.has("C") ? "C" : "c"}`);
  for (const mode of parsed.values.get("mode") ?? []) {
    const flag = Object.hasOwn(SORT_MODE_FLAGS, mode) ? SORT_MODE_FLAGS[mode] : undefined;
    if (flag === undefined) throw new UsageError(`invalid sort argument '${mode}'`);
    parsed.flags.add(flag);
  }
  await assertInputRequirements(context, parsed.operands);
  if (!checking) await admitTextOutput(context, value(parsed, "o"));
  const rawSeparator = value(parsed, "t");
  const separatorText = rawSeparator === "" || rawSeparator === "\\0" ? "\0" : rawSeparator;
  if (separatorText !== undefined && encoder.encode(separatorText).length !== 1) throw new UsageError("field separator must be one byte");
  const separator = separatorText === undefined ? undefined : encoder.encode(separatorText)[0];
  const keys = (parsed.values.get("k") ?? []).map(sortKey);
  for (const key of keys.length ? keys : [undefined]) {
    const flags = key?.flags.size ? key.flags : parsed.flags;
    const modes = ["g", "h", "M", "n", "V"].filter(flag => flags.has(flag));
    const nontextual = ["g", "h", "M", "n"].some(flag => flags.has(flag));
    if (modes.length > 1 || nontextual && (flags.has("d") || flags.has("i"))) {
      const incompatible = ["d", "g", "h", "i", "M", "n", ...(modes.length > 1 ? ["V"] : [])].filter(flag => flags.has(flag));
      throw new UsageError(`options '-${incompatible.join("")}' are incompatible`);
    }
  }
  const limits = resolveSortLimits(settings.limits, parsed);
  const collator = sortCollator(context.env);
  const simple = !keys.length && !["b", "f", "h", "n", "g", "M", "V", "d", "i"].some(flag => parsed.flags.has(flag));
  const direction = parsed.flags.has("r") ? -1 : 1;
  const work = new SortWork(context.signal);
  const decoder = collator ? new TextDecoder("utf-8", { fatal: true }) : undefined;
  const compareText = collator ? async (left: Uint8Array, right: Uint8Array, work: SortWork): Promise<number> => {
    await work.charge(left.length + right.length);
    let first: string | undefined, second: string | undefined;
    try { first = decoder!.decode(left); } catch { /* Invalid bytes follow valid text. */ }
    try { second = decoder!.decode(right); } catch { /* Preserve byte ordering for invalid text. */ }
    if (first === undefined) return second === undefined ? compareSortBytes(left, right, work) : 1;
    return second === undefined ? -1 : collator.compare(first, second);
  } : compareSortBytes;
  const keyBytesCompare = async (left: Uint8Array, right: Uint8Array): Promise<number> => {
        await work.charge();
        for (const key of keys.length ? keys : [undefined]) {
          await work.charge();
          const flags = key?.flags.size ? key.flags : parsed.flags;
          let first = key ? await keyBytes(left, key, separator, flags.has("b"), work) : left;
          let second = key ? await keyBytes(right, key, separator, flags.has("b"), work) : right;
          if (!key && flags.has("b")) {
            const trim = async (bytes: Uint8Array) => {
              let offset = 0;
              while (bytes[offset] === 9 || bytes[offset] === 32) {
                if (++offset % 1024 === 0) await work.charge(1024);
              }
              await work.charge(offset % 1024);
              return bytes.subarray(offset);
            };
            first = await trim(first); second = await trim(second);
          }
          if (flags.has("f")) { first = await foldSortBytes(first, work); second = await foldSortBytes(second, work); }
          if (flags.has("d") || flags.has("i")) { first = await filterSortBytes(first, flags.has("d"), work); second = await filterSortBytes(second, flags.has("d"), work); }
          let result: number;
          if (flags.has("g")) {
            const a = await generalNumericValue(first, work), b = await generalNumericValue(second, work);
            result = a.rank - b.rank || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
          } else if (flags.has("M")) result = await monthValue(first, work) - await monthValue(second, work);
          else if (flags.has("V")) result = await compareVersions(first, second, work);
          else result = flags.has("n") || flags.has("h") ? await compareNumericValues(await parseNumeric(first, work, flags.has("h")), await parseNumeric(second, work, flags.has("h")), work) : await compareText(first, second, work);
          if (flags.has("r")) result = -result;
          if (result) return result;
        }
        return 0;
      };
  const resources = new SortStorage(context, limits, work);
  const active = resources.context;
  const delimiter = parsed.flags.has("z") ? 0 : 10;
  const destination = value(parsed, "o");
  const names = parsed.operands.length ? parsed.operands : ["-"];
  const keyCompare = async (left: SortRecord, right: SortRecord): Promise<number> => {
    active.signal.throwIfAborted();
    if (simple && !collator) return (await compareRecordBytes(left, right, work)) * direction;
    if (left.length > resources.recordBytes || right.length > resources.recordBytes) {
      return compareLargeKeys(left, right, keys, parsed.flags, separator, work, resources,
        collator ? (a, b) => compareText(a, b, work) : undefined);
    }
    return keyBytesCompare(await left.materialize(), await right.materialize());
  };
  const compare = async (left: SortRecord, right: SortRecord): Promise<number> => {
    const result = await keyCompare(left, right);
    if (result || simple || parsed.flags.has("s") || parsed.flags.has("u")) return result;
    return (collator ? await compareText(await left.materialize(), await right.materialize(), work)
      : await compareRecordBytes(left, right, work)) * direction;
  };
  const source = (name: string) => readRecords(name === "-" ? active.stdin : input(active, name), delimiter, resources);
  let failed = false;
  try {
    if (checking) {
      let previous: SortRecord | undefined, ordinal = 0;
      let readFailed = false;
      try {
        for await (const record of source(names[0]!)) {
          let recordFailed = false;
          ordinal++;
          try {
            if (previous && (await compare(previous, record) > 0 || parsed.flags.has("u") && await keyCompare(previous, record) === 0)) {
              if (!parsed.flags.has("C")) await diagnostic(active, new PublicDiagnostic(`disorder at record ${ordinal}`));
              return { exitCode: 1 };
            }
            await previous?.close();
            previous = record;
          } catch (error) { recordFailed = true; throw error; }
          finally { if (previous !== record) await record.close().catch(error => { if (!recordFailed) throw error; }); }
        }
      } catch (error) { readFailed = true; throw error; }
      finally { await previous?.close().catch(error => { if (!readFailed) throw error; }); }
      return { exitCode: 0 };
    }
    const runs = new SortRuns(resources, compare);
    let ordered: AsyncIterable<SortRecord>;
    if (parsed.flags.has("m")) {
      if (names.length <= limits.mergeFanIn) ordered = mergeRecords(names.map(source), compare);
      else {
        for (let offset = 0; offset < names.length; offset += limits.mergeFanIn) {
          const merged = mergeRecords(names.slice(offset, offset + limits.mergeFanIn).map(source), compare);
          await runs.add(await runs.save(merged));
        }
        ordered = runs.finish();
      }
      // Read every source before opening an output path, including unknown aliases.
      if (destination !== undefined) ordered = runs.read(await runs.save(ordered));
    } else {
      const all = (async function* () { for (const name of names) yield* source(name); })();
      ordered = await runs.sort(all, work);
    }
    const outputRecords = (async function* (): ByteSource {
      let previous: SortRecord | undefined;
      let readFailed = false;
      try {
        for await (const record of ordered) {
          let recordFailed = false;
          try {
            if (parsed.flags.has("u") && previous && await keyCompare(previous, record) === 0) continue;
            await previous?.close(); previous = undefined;
            yield* record.chunks();
            yield recordSeparators[delimiter];
            if (parsed.flags.has("u")) previous = record;
          } catch (error) { recordFailed = true; throw error; }
          finally { if (previous !== record) await record.close().catch(error => { if (!recordFailed) throw error; }); }
        }
      } catch (error) { readFailed = true; throw error; }
      finally { await previous?.close().catch(error => { if (!readFailed) throw error; }); }
    })();
    await emitRecords(context, outputRecords, destination, parsed.flags.has("m"));
    return { exitCode: 0 };
  } catch (error) { failed = true; throw error; }
  finally {
    await resources.close().catch(error => { if (!failed) throw error; });
  }
}

export function createSortCommand(settings: SortCommandsOptions = {}): CommandDefinition {
  resolveSortLimits(settings.limits);
  return { ...define("sort", context => {
    runYieldCheckpoint(context.signal);
    return executeSort(context, settings);
  }, 2), filesystemRequirements: textOutputRequirements };
}

async function compareRecordBytes(left: SortRecord, right: SortRecord, work: SortWork): Promise<number> {
  await work.charge();
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset += 16 * 1024) {
    const count = Math.min(16 * 1024, length - offset);
    const first = await left.read(offset, count), second = await right.read(offset, count);
    const result = await compareSortBytes(first, second, work);
    if (result) return result;
  }
  return left.length - right.length;
}
