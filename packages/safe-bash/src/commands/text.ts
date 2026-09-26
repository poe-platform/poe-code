import { PublicDiagnostic } from "../diagnostics.js";
import { FsError, type ByteSource, type CommandContext, type CommandDefinition } from "../contracts/index.js";
import { assertInputRequirements, bufferLimit, codeOf, concatenate, define, diagnostic, encoder, input, integer, lines, options, output, pathOf, requireOperands, RESOLVED_EXIT_ZERO, UsageError, value } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { inputRequirements, textOutputRequirements } from "./portable-requirements.js";
import { hasYieldCheckpoint, runYieldCheckpoint, yieldTurn } from "../contracts/yield.js";
import { RecordBuffer } from "./record-buffer.js";
import { SortRecordBudget } from "./sort-admission.js";
import { compareObservedEntries } from "./copy-identity.js";

class SortWork {
  #pending = 0;
  #syncTurns = 0;

  constructor(readonly signal: AbortSignal) {
    this.signal.throwIfAborted();
  }

  charge(units = 1): Promise<void> | undefined {
    this.#pending += units;
    if (this.#pending >= 4096) {
      if (!hasYieldCheckpoint(this.signal)) {
        while (this.#pending >= 4096) {
          this.#pending -= 4096;
          runYieldCheckpoint(this.signal);
          this.signal.throwIfAborted();
          if (++this.#syncTurns >= 32) {
            this.#syncTurns = 0;
            return this.#checkpointOnce();
          }
        }
        return undefined;
      }
      return this.#checkpoint();
    }
  }

  async #checkpointOnce(): Promise<void> {
    await yieldTurn(this.signal);
    this.signal.throwIfAborted();
  }

  async #checkpoint(): Promise<void> {
    while (this.#pending >= 4096) {
      this.#pending -= 4096;
      await yieldTurn(this.signal);
      this.signal.throwIfAborted();
    }
  }
}

async function sortRecords<Record>(records: Record[], compare: (left: Record, right: Record) => number | Promise<number>, work: SortWork): Promise<Record[]> {
  if (records.length < 2) return records;
  let source = records;
  let target = new Array<Record>(records.length);
  for (let width = 1; width < records.length; width *= 2) {
    for (let begin = 0; begin < records.length; begin += width * 2) {
      const middle = Math.min(begin + width, records.length);
      const end = Math.min(begin + width * 2, records.length);
      let left = begin;
      let right = middle;
      for (let index = begin; index < end; index++) {
        const checkpoint = work.charge();
        if (checkpoint) await checkpoint;
        if (left < middle) {
          if (right === end) {
            target[index] = source[left++]!;
            continue;
          }
          const compared = compare(source[left]!, source[right]!);
          const order = typeof compared === "number" ? compared : await compared;
          if (order <= 0) {
            target[index] = source[left++]!;
            continue;
          }
        }
        target[index] = source[right++]!;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

interface CutRange { start: number; end: number }

async function cutRanges(list: string, work: SortWork): Promise<CutRange[]> {
  const ranges: CutRange[] = [];
  let tokenStart = 0;
  let dash = -1;
  let start = 0;
  let end = 0;
  let invalid = false;
  let needsRange = true;
  for (let index = 0; index <= list.length; index++) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    const character = list[index];
    if (character === "," || character === " " || character === "\t" || index === list.length) {
      if (index === tokenStart) {
        if (needsRange && (character === "," || index === list.length)) throw new UsageError("invalid range ''");
        if (character === ",") needsRange = true;
        tokenStart = index + 1;
        continue;
      }
      if (invalid || (dash === tokenStart && dash === index - 1)) throw new UsageError(`invalid range '${list.slice(tokenStart, index)}'`);
      if (dash === tokenStart) start = 1;
      if (dash < 0) end = start;
      const openEnd = dash >= 0 && dash === index - 1;
      if (openEnd) end = Infinity;
      if (!Number.isSafeInteger(start) || start < 1) throw new UsageError(`invalid number '${list.slice(tokenStart, dash < 0 ? index : dash)}'`);
      if (!openEnd && (!Number.isSafeInteger(end) || end < 1)) throw new UsageError(`invalid number '${list.slice(dash < 0 ? tokenStart : dash + 1, index)}'`);
      if (end < start) throw new UsageError(`decreasing range '${list.slice(tokenStart, index)}'`);
      ranges.push({ start, end });
      needsRange = character === ",";
      tokenStart = index + 1;
      dash = -1;
      start = 0;
      end = 0;
      invalid = false;
    } else if (character === "-" && dash < 0) {
      dash = index;
    } else {
      const digit = list.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9) invalid = true;
      else if (dash < 0) start = start * 10 + digit;
      else end = end * 10 + digit;
    }
  }
  const ordered = await sortRecords(ranges, (left, right) => left.start - right.start, work);
  const normalized: CutRange[] = [];
  for (const range of ordered) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    const previous = normalized.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else normalized.push(range);
  }
  return normalized;
}

const sharedCutOutBuffer = new Uint8Array(64 * 1024);
let sharedCutOutInUse = false;
const sharedUniqOutBuffer = new Uint8Array(128 * 1024);

function writeUniqCountBytes(writeByte: (b: number) => void, count: number): void {
  const digits = String(count);
  const pad = 7 - digits.length;
  for (let i = 0; i < pad; i++) writeByte(32);
  for (let i = 0; i < digits.length; i++) writeByte(digits.charCodeAt(i));
  writeByte(32);
}

class CutOutput {
  readonly #buffer: Uint8Array;
  readonly #ownsShared: boolean;
  #used = 0;

  constructor(readonly context: CommandContext, readonly work: SortWork) {
    if (!sharedCutOutInUse) {
      sharedCutOutInUse = true;
      this.#buffer = sharedCutOutBuffer;
      this.#ownsShared = true;
    } else {
      this.#buffer = new Uint8Array(64 * 1024);
      this.#ownsShared = false;
    }
  }

  get remaining(): number {
    return this.#buffer.length - this.#used;
  }

  writeRangeUncharged(source: Uint8Array, start: number, end: number): number {
    const len = end - start;
    const buf = this.#buffer;
    let dst = this.#used;
    for (let i = start; i < end; i++) buf[dst++] = source[i]!;
    this.#used = dst;
    return len;
  }

  writeByteUncharged(byte: number): void {
    this.#buffer[this.#used++] = byte;
  }

  write(bytes: Uint8Array): Promise<void> | undefined {
    if (bytes.length <= 4096 && this.#used + bytes.length < this.#buffer.length) {
      const checkpoint = this.work.charge(bytes.length);
      this.#buffer.set(bytes, this.#used);
      this.#used += bytes.length;
      return checkpoint;
    }
    return this.#writeSlow(bytes);
  }

  writeRange(source: Uint8Array, start: number, end: number): Promise<void> | undefined {
    const len = end - start;
    if (len <= 4096 && this.#used + len < this.#buffer.length) {
      const checkpoint = this.work.charge(len);
      for (let i = 0; i < len; i++) this.#buffer[this.#used + i] = source[start + i]!;
      this.#used += len;
      return checkpoint;
    }
    return this.#writeSlow(source.subarray(start, end));
  }

  writeByte(byte: number): Promise<void> | undefined {
    if (this.#used + 1 < this.#buffer.length) {
      const checkpoint = this.work.charge(1);
      this.#buffer[this.#used++] = byte;
      return checkpoint;
    }
    return this.#writeSlow(Uint8Array.of(byte));
  }

  async #writeSlow(bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(4096, bytes.length - offset, this.#buffer.length - this.#used);
      const checkpoint = this.work.charge(length);
      if (checkpoint) await checkpoint;
      this.#buffer.set(bytes.subarray(offset, offset + length), this.#used);
      this.#used += length;
      offset += length;
      if (this.#used === this.#buffer.length) await this.flush();
    }
  }

  async text(text: string): Promise<void> {
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 4096, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      await this.write(encoder.encode(text.slice(offset, end)));
      offset = end;
    }
  }

  async flush(): Promise<void> {
    if (!this.#used) return;
    const bytes = this.#buffer.slice(0, this.#used);
    this.#used = 0;
    await output(this.context, bytes);
  }

  release(): void {
    if (this.#ownsShared) sharedCutOutInUse = false;
  }
}

function cutFieldBoundary(record: Buffer, separator: Uint8Array, start: number, work: SortWork): number | Promise<number> {
  if (record.length - start <= 4096) {
    const found = separator.length === 1
      ? record.indexOf(separator[0]!, start)
      : record.indexOf(separator, start);
    const charged = found < 0 ? record.length - start : found - start + separator.length;
    const checkpoint = work.charge(charged);
    return checkpoint ? checkpoint.then(() => found) : found;
  }
  return cutFieldBoundarySlow(record, separator, start, work);
}

async function cutFieldBoundarySlow(record: Buffer, separator: Uint8Array, start: number, work: SortWork): Promise<number> {
  for (let offset = start; offset < record.length; offset += 4096) {
    const window = record.subarray(offset, Math.min(record.length, offset + 4096 + separator.length - 1));
    const found = window.indexOf(separator);
    const checkpoint = work.charge(found < 0 ? Math.min(4096, window.length) : found + separator.length);
    if (checkpoint) await checkpoint;
    if (found >= 0) return offset + found;
  }
  return -1;
}

const emptySortRecord = new Uint8Array(0);
const defaultSortAdmit = SortRecordBudget.prototype.admit;
const defaultUint8Array = Uint8Array;
const EMPTY_OPERANDS: readonly string[] = Object.freeze([]);

async function resolveAfterCheckpoint(checkpoint: Promise<void>, value: number): Promise<number> {
  await checkpoint;
  return value;
}

async function resolveValueAfterCheckpoint<T>(checkpoint: Promise<void>, value: T): Promise<T> {
  await checkpoint;
  return value;
}

async function resolveScaledAfterPromise(pending: Promise<number>, scale: number): Promise<number> {
  return (await pending) * scale;
}

async function compareSortBytesLargeAsync(left: Uint8Array, right: Uint8Array, length: number, work: SortWork): Promise<number> {
  for (let offset = 0; offset < length; offset += 1024) {
    const end = Math.min(offset + 1024, length);
    const checkpoint = work.charge(2 * (end - offset));
    if (checkpoint) await checkpoint;
    const compared = Buffer.compare(left.subarray(offset, end), right.subarray(offset, end));
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

function compareBytes(left: Uint8Array, right: Uint8Array): number { return Buffer.compare(left, right); }
function fold(bytes: Uint8Array): Uint8Array { return bytes.map(byte => byte >= 97 && byte <= 122 ? byte - 32 : byte); }

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

interface SortKey { start: number; startCharacter: number; startBlanks: boolean; endBlanks: boolean; end?: number; endCharacter?: number; flags: Set<string> }

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
  const text = Buffer.from(bytes.subarray(start)).toString("latin1");
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
  const name = Buffer.from(bytes.subarray(offset, offset + 3)).toString("latin1").toUpperCase();
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

async function mergeSortRuns(runs: Uint8Array[][], compare: (left: Uint8Array, right: Uint8Array) => number | Promise<number>, work: SortWork): Promise<Uint8Array[]> {
  while (runs.length > 1) {
    const next: Uint8Array[][] = [];
    for (let index = 0; index < runs.length; index += 2) {
      const left = runs[index]!, right = runs[index + 1] ?? [];
      const merged: Uint8Array[] = [];
      let first = 0, second = 0;
      while (first < left.length || second < right.length) {
        const checkpoint = work.charge();
        if (checkpoint) await checkpoint;
        if (first < left.length) {
          if (second === right.length) {
            merged.push(left[first++]!);
            continue;
          }
          const compared = compare(left[first]!, right[second]!);
          const order = typeof compared === "number" ? compared : await compared;
          if (order <= 0) {
            merged.push(left[first++]!);
            continue;
          }
        }
        merged.push(right[second++]!);
      }
      next.push(merged);
    }
    runs = next;
  }
  return runs[0] ?? [];
}

const syncFieldStarts = new Int32Array(1025);
const syncFieldEnds = new Int32Array(1025);
let lastKeyNumericLength = 0;

function keyBytesSync(line: Uint8Array, key: SortKey, separator: number | undefined, blanks: boolean, work: SortWork): Uint8Array | Promise<Uint8Array> {
  if (line.length > 1024) return keyBytes(line, key, separator, blanks, work);
  let fieldCount = 0;
  if (separator !== undefined) {
    let start = 0;
    for (let offset = 0; offset <= line.length; offset++) {
      if (offset === line.length || line[offset] === separator) {
        syncFieldStarts[fieldCount] = start;
        syncFieldEnds[fieldCount] = offset;
        fieldCount++;
        start = offset + 1;
      }
    }
  } else {
    let offset = 0;
    while (offset < line.length) {
      const leading = offset;
      while (offset < line.length && (line[offset] === 32 || line[offset] === 9)) offset++;
      const start = leading;
      while (offset < line.length && line[offset] !== 32 && line[offset] !== 9) offset++;
      syncFieldStarts[fieldCount] = start;
      syncFieldEnds[fieldCount] = offset;
      fieldCount++;
    }
  }
  let extraCharge = line.length;
  const inheritBlanks = key.flags.size === 0 && blanks;
  const startIdx = key.start - 1;
  let startOffset = line.length;
  if (startIdx >= 0 && startIdx < fieldCount) {
    startOffset = syncFieldStarts[startIdx]!;
    const fEnd = syncFieldEnds[startIdx]!;
    if (key.startBlanks || inheritBlanks) {
      while (startOffset < fEnd && (line[startOffset] === 32 || line[startOffset] === 9)) {
        extraCharge++;
        startOffset++;
      }
    }
  }
  const start = startOffset + key.startCharacter - 1;
  const lastIdx = key.end === undefined ? -1 : key.end - 1;
  const hasLast = lastIdx >= 0 && lastIdx < fieldCount;
  let end: number;
  if (key.end === undefined || !hasLast) {
    end = line.length;
  } else if (key.endCharacter === undefined) {
    end = syncFieldEnds[lastIdx]!;
  } else {
    let lastStart = syncFieldStarts[lastIdx]!;
    const fEnd = syncFieldEnds[lastIdx]!;
    if (key.endBlanks || inheritBlanks) {
      while (lastStart < fEnd && (line[lastStart] === 32 || line[lastStart] === 9)) {
        extraCharge++;
        lastStart++;
      }
    }
    end = Math.min(line.length, lastStart + key.endCharacter);
  }
  const result = line.subarray(Math.min(start, line.length), Math.max(start, end));
  const checkpoint = work.charge(extraCharge);
  return checkpoint ? resolveValueAfterCheckpoint(checkpoint, result) : result;
}

const sharedSortStarts = new Int32Array(4096);
const sharedSortEnds = new Int32Array(4096);
const sharedSortIndices = new Int32Array(4096);
const sharedSortScratchIndices = new Int32Array(4096);
const sharedSortKeyNums = new Int32Array(4096);
const sharedSortInScratch = new Uint8Array(65536);
const sharedSortOutScratch = new Uint8Array(65536);
const SORT_LONG_OPTIONS = Object.freeze({
  "human-numeric-sort": "h",
  "numeric-sort": "n",
  "general-numeric-sort": "g",
  "month-sort": "M",
  "version-sort": "V",
  "dictionary-order": "d",
  "ignore-nonprinting": "i",
  merge: "m",
  sort: "S",
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

function compareChunkSliceBytes(
  chunk: Uint8Array,
  sA: number,
  eA: number,
  sB: number,
  eB: number,
): number {
  const lenA = eA - sA;
  const lenB = eB - sB;
  const minLen = lenA < lenB ? lenA : lenB;
  for (let i = 0; i < minLen; i++) {
    const diff = chunk[sA + i]! - chunk[sB + i]!;
    if (diff !== 0) return diff;
  }
  return lenA - lenB;
}

function parseFastCanonicalNumericKey(
  chunk: Uint8Array,
  lineStart: number,
  lineEnd: number,
  key: SortKey,
  separator: number | undefined,
): number {
  const len = lineEnd - lineStart;
  if (len > 1024) return -1;
  let fieldCount = 0;
  if (separator !== undefined) {
    let start = lineStart;
    for (let offset = lineStart; offset <= lineEnd; offset++) {
      if (offset === lineEnd || chunk[offset] === separator) {
        if (fieldCount < 256) {
          syncFieldStarts[fieldCount] = start;
          syncFieldEnds[fieldCount] = offset;
        }
        fieldCount++;
        start = offset + 1;
      }
    }
  } else {
    let offset = lineStart;
    while (offset < lineEnd) {
      const leading = offset;
      while (offset < lineEnd && (chunk[offset] === 32 || chunk[offset] === 9)) offset++;
      const start = leading;
      while (offset < lineEnd && chunk[offset] !== 32 && chunk[offset] !== 9) offset++;
      if (fieldCount < 256) {
        syncFieldStarts[fieldCount] = start;
        syncFieldEnds[fieldCount] = offset;
      }
      fieldCount++;
    }
  }
  const startIdx = key.start - 1;
  if (startIdx < 0 || startIdx >= fieldCount || startIdx >= 256) return -1;
  let fStart = syncFieldStarts[startIdx]!;
  let fEnd = lineEnd;
  if (key.end !== undefined) {
    const endIdx = key.end - 1;
    if (endIdx < 0 || endIdx >= fieldCount || endIdx >= 256) return -1;
    fEnd = syncFieldEnds[endIdx]!;
  }
  while (fStart < fEnd && (chunk[fStart] === 32 || chunk[fStart] === 9)) fStart++;
  if (fStart >= fEnd) return -1;
  const kLen = fEnd - fStart;
  if (kLen > 9) return -1;
  const first = chunk[fStart]!;
  if (first === 48) {
    return kLen === 1 ? 0 : -1;
  }
  if (first < 49 || first > 57) return -1;
  let num = first - 48;
  for (let i = fStart + 1; i < fEnd; i++) {
    const c = chunk[i]!;
    if (c < 48 || c > 57) return -1;
    num = num * 10 + (c - 48);
  }
  return num;
}

function keyNumericValueSync(
  line: Uint8Array,
  key: SortKey,
  separator: number | undefined,
  blanks: boolean,
  work: SortWork,
  human: boolean,
): NumericValue | undefined {
  if (line.length > 1024) return undefined;
  let fieldCount = 0;
  if (separator !== undefined) {
    let start = 0;
    for (let offset = 0; offset <= line.length; offset++) {
      if (offset === line.length || line[offset] === separator) {
        syncFieldStarts[fieldCount] = start;
        syncFieldEnds[fieldCount] = offset;
        fieldCount++;
        start = offset + 1;
      }
    }
  } else {
    let offset = 0;
    while (offset < line.length) {
      const leading = offset;
      while (offset < line.length && (line[offset] === 32 || line[offset] === 9)) offset++;
      const start = leading;
      while (offset < line.length && line[offset] !== 32 && line[offset] !== 9) offset++;
      syncFieldStarts[fieldCount] = start;
      syncFieldEnds[fieldCount] = offset;
      fieldCount++;
    }
  }
  let extraCharge = line.length;
  const inheritBlanks = key.flags.size === 0 && blanks;
  const startIdx = key.start - 1;
  let startOffset = line.length;
  if (startIdx >= 0 && startIdx < fieldCount) {
    startOffset = syncFieldStarts[startIdx]!;
    const fEnd = syncFieldEnds[startIdx]!;
    if (key.startBlanks || inheritBlanks) {
      while (startOffset < fEnd && (line[startOffset] === 32 || line[startOffset] === 9)) {
        extraCharge++;
        startOffset++;
      }
    }
  }
  const start = startOffset + key.startCharacter - 1;
  const lastIdx = key.end === undefined ? -1 : key.end - 1;
  const hasLast = lastIdx >= 0 && lastIdx < fieldCount;
  let end: number;
  if (key.end === undefined || !hasLast) {
    end = line.length;
  } else if (key.endCharacter === undefined) {
    end = syncFieldEnds[lastIdx]!;
  } else {
    let lastStart = syncFieldStarts[lastIdx]!;
    const fEnd = syncFieldEnds[lastIdx]!;
    if (key.endBlanks || inheritBlanks) {
      while (lastStart < fEnd && (line[lastStart] === 32 || line[lastStart] === 9)) {
        extraCharge++;
        lastStart++;
      }
    }
    end = Math.min(line.length, lastStart + key.endCharacter);
  }
  const sliceStart = Math.min(start, line.length);
  const sliceEnd = Math.max(start, end);
  const keyLength = sliceEnd - sliceStart;
  const checkpoint = work.charge(extraCharge + keyLength);
  if (checkpoint !== undefined) return undefined;
  lastKeyNumericLength = keyLength;
  return parseNumericRangeSync(line, sliceStart, sliceEnd, human);
}

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

async function emitRecords(context: CommandContext, records: ByteSource, destination?: string): Promise<void> {
  if (destination === undefined) { for await (const bytes of records) await output(context, bytes); return; }
  await admitTextOutput(context, destination);
  const capabilities = await context.fs.capabilitiesFor?.(pathOf(context, destination), { signal: context.signal }) ?? context.fs.capabilities;
  if (context.fs.writeStream && capabilities.streamingWrite !== false) await context.fs.writeStream(pathOf(context, destination), records, { signal: context.signal });
  else {
    if (capabilities.write === false) throw new FsError("ENOTSUP", { syscall: "writeFile", path: pathOf(context, destination) });
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const bytes of records) {
      size += bytes.length;
      if (size > bufferLimit) throw new FsError("EFBIG", { message: "output buffer limit exceeded" });
      chunks.push(bytes);
    }
    await context.fs.writeFile(pathOf(context, destination), concatenate(chunks, size), { signal: context.signal });
  }
}

async function collectSortRecords(
  source: ByteSource, delimiter: number, budget: SortRecordBudget, signal: AbortSignal,
  accept: (bytes: Uint8Array) => boolean | void | Promise<boolean | void>,
): Promise<boolean> {
  const pending = new RecordBuffer(bufferLimit);
  const admit = (length: number): void => {
    signal.throwIfAborted();
    budget.admit(length);
  };
  try {
    for await (const chunk of source) {
      let start = 0;
      let ownedChunk: Uint8Array | undefined;
      const canShareChunk =
        SortRecordBudget.prototype.admit === defaultSortAdmit &&
        Uint8Array === defaultUint8Array &&
        budget.canAdmitChunk(chunk.length);
      while (start < chunk.length) {
        const offset = chunk.indexOf(delimiter, start);
        if (offset < 0) break;
        let record: Uint8Array;
        if (pending.size === 0) {
          const tailLength = offset - start;
          if (tailLength > bufferLimit) throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
          admit(tailLength);
          if (tailLength > bufferLimit * 2) throw new FsError("EFBIG", { message: "line finalization buffer limit exceeded" });
          if (tailLength === 0) {
            record = emptySortRecord;
          } else if (canShareChunk) {
            ownedChunk ??= new Uint8Array(chunk);
            record = ownedChunk.subarray(start, offset);
          } else {
            // Later records in this chunk have not passed admission yet.
            record = new Uint8Array(tailLength);
            record.set(chunk.subarray(start, offset));
          }
        } else {
          record = pending.finish(admit, chunk, start, offset);
        }
        const accepted = accept(record);
        if ((accepted instanceof Promise ? await accepted : accepted) === false) return false;
        start = offset + 1;
      }
      pending.append(chunk, start);
    }
    if (pending.size) return await accept(pending.finish(admit)) !== false;
    return true;
  } finally { pending.clear(); }
}

async function executeSortGeneral(
  context: CommandContext,
  preReadChunks?: Uint8Array[],
): Promise<{ exitCode: number }> {
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
      const parsed = options(args, "hngMVdimrfbuszt:k:o:cCS:", SORT_LONG_OPTIONS, false, undefined, (key, index) => {
        // S is only an internal value slot for --sort, not a buffer-size option.
        if (key === "S" && !args[index]!.startsWith("--sort=") && args[index - 1] !== "--sort") throw new UsageError("invalid option -- 'S'");
      });
      if (parsed.flags.has("c") && parsed.flags.has("C")) throw new UsageError("options '-cC' are incompatible");
      const checking = parsed.flags.has("c") || parsed.flags.has("C");
      if (checking && parsed.operands.length > 1) throw new UsageError(`extra operand '${parsed.operands[1]}' not allowed with -${parsed.flags.has("C") ? "C" : "c"}`);
      for (const mode of parsed.values.get("S") ?? []) {
        const flag = Object.hasOwn(SORT_MODE_FLAGS, mode) ? SORT_MODE_FLAGS[mode] : undefined;
        if (flag === undefined) throw new UsageError(`invalid sort argument '${mode}'`);
        parsed.flags.add(flag);
      }
      if (!preReadChunks) {
        await assertInputRequirements(context, parsed.operands);
        if (!checking) await admitTextOutput(context, value(parsed, "o"));
      }
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
      const simple = !keys.length && !["b", "f", "h", "n", "g", "M", "V", "d", "i"].some(flag => parsed.flags.has(flag));
      const direction = parsed.flags.has("r") ? -1 : 1;
      const work = new SortWork(context.signal);
      const numericKey = keys.length === 1 ? keys[0] : undefined;
      const numericKeyFlags = numericKey?.flags.size ? numericKey.flags : parsed.flags;
      const skipTieFallback = simple || parsed.flags.has("s") || parsed.flags.has("u");
      const recordBudget = new SortRecordBudget();
      const exitCode: number = 0;
      const delimiter = parsed.flags.has("z") ? 0 : 10;
      const outPath = value(parsed, "o");
      const canFastIndexSort =
        !preReadChunks &&
        !checking &&
        !hasYieldCheckpoint(context.signal) &&
        !parsed.flags.has("m") &&
        !parsed.flags.has("u") &&
        outPath === undefined &&
        (parsed.operands.length === 0 || (parsed.operands.length === 1 && parsed.operands[0] === "-")) &&
        SortRecordBudget.prototype.admit === defaultSortAdmit &&
        Uint8Array === defaultUint8Array &&
        (simple || (
          keys.length === 1 &&
          numericKey !== undefined &&
          numericKeyFlags.has("n") &&
          !numericKeyFlags.has("h") &&
          !["b", "f", "d", "i", "M", "V", "g"].some(flag => numericKeyFlags.has(flag)) &&
          !["b", "f", "d", "i", "n", "h", "M", "V", "g"].some(flag => parsed.flags.has(flag)) &&
          numericKey.startCharacter === 1 &&
          (numericKey.endCharacter === undefined || numericKey.endCharacter === 0)
        ));
      if (canFastIndexSort) {
        let firstChunk: Uint8Array | undefined;
        let moreChunks: Uint8Array[] | undefined;
        let totalChunkBytes = 0;
        try {
          for await (const ch of input(context, "-")) {
            if (ch.length === 0) continue;
            totalChunkBytes += ch.length;
            if (!firstChunk) firstChunk = ch;
            else (moreChunks ??= [firstChunk]).push(ch);
          }
        } catch (error) {
          await diagnostic(context, error);
          return { exitCode: 2 };
        }
        if (!firstChunk) return { exitCode: 0 };
        if (moreChunks && totalChunkBytes <= 65536) {
          let pos = 0;
          for (let i = 0; i < moreChunks.length; i++) {
            const c = moreChunks[i]!;
            sharedSortInScratch.set(c, pos);
            pos += c.length;
          }
          firstChunk = sharedSortInScratch.subarray(0, totalChunkBytes);
          moreChunks = undefined;
        }
        if (
          !moreChunks &&
          firstChunk.length <= 65536 &&
          firstChunk[firstChunk.length - 1] === delimiter &&
          recordBudget.canAdmitChunk(firstChunk.length)
        ) {
          let start = 0;
          let count = 0;
          let validLines = true;
          while (start < firstChunk.length) {
            const offset = firstChunk.indexOf(delimiter, start);
            if (offset < 0 || count >= 4096 || offset - start > bufferLimit) {
              validLines = false;
              break;
            }
            sharedSortStarts[count] = start;
            sharedSortEnds[count] = offset;
            sharedSortIndices[count] = count;
            if (!simple && numericKey) {
              const kNum = parseFastCanonicalNumericKey(firstChunk, start, offset, numericKey, separator);
              if (kNum < 0) {
                validLines = false;
                break;
              }
              sharedSortKeyNums[count] = kNum;
            }
            count++;
            start = offset + 1;
          }
          if (validLines) {
            for (let i = 0; i < count; i++) {
              context.signal.throwIfAborted();
              recordBudget.admit(sharedSortEnds[i]! - sharedSortStarts[i]!);
            }
            const revScale = numericKeyFlags?.has("r") ? -1 : 1;
            let src = sharedSortIndices;
            let dst = sharedSortScratchIndices;
            for (let width = 1; width < count; width *= 2) {
              for (let begin = 0; begin < count; begin += width * 2) {
                const middle = Math.min(begin + width, count);
                const end = Math.min(begin + width * 2, count);
                let left = begin;
                let right = middle;
                for (let index = begin; index < end; index++) {
                  const cp = work.charge(4);
                  if (cp) await cp;
                  if (left < middle) {
                    if (right === end) {
                      dst[index] = src[left++]!;
                      continue;
                    }
                    const a = src[left]!;
                    const b = src[right]!;
                    let order = 0;
                    if (simple) {
                      order = compareChunkSliceBytes(firstChunk, sharedSortStarts[a]!, sharedSortEnds[a]!, sharedSortStarts[b]!, sharedSortEnds[b]!) * direction;
                    } else {
                      const diff = sharedSortKeyNums[a]! - sharedSortKeyNums[b]!;
                      order = diff === 0 ? 0 : (diff < 0 ? -revScale : revScale);
                      if (order === 0 && !skipTieFallback) {
                        order = compareChunkSliceBytes(firstChunk, sharedSortStarts[a]!, sharedSortEnds[a]!, sharedSortStarts[b]!, sharedSortEnds[b]!) * direction;
                      }
                    }
                    if (order <= 0) {
                      dst[index] = src[left++]!;
                      continue;
                    }
                  }
                  dst[index] = src[right++]!;
                }
              }
              const tmp = src;
              src = dst;
              dst = tmp;
            }
            const outBuf = sharedSortOutScratch.subarray(0, firstChunk.length);
            let used = 0;
            for (let i = 0; i < count; i++) {
              const idx = src[i]!;
              const s = sharedSortStarts[idx]!;
              const e = sharedSortEnds[idx]!;
              for (let p = s; p < e; p++) outBuf[used++] = firstChunk[p]!;
              outBuf[used++] = delimiter;
            }
            await output(context, outBuf);
            return { exitCode: 0 };
          }
          if (firstChunk.buffer === sharedSortInScratch.buffer) {
            firstChunk = new Uint8Array(firstChunk);
          }
        }
        preReadChunks = moreChunks ?? [firstChunk];
      }
      let compareNumeric = async (left: Uint8Array, right: Uint8Array, human: boolean) => compareNumericValues(await parseNumeric(left, work, human), await parseNumeric(right, work, human), work);
      const isUnkeyedNumericFast = !keys.length && (parsed.flags.has("n") || parsed.flags.has("h")) && !["b", "f", "c", "d", "i"].some(flag => parsed.flags.has(flag));
      const numericValues = isUnkeyedNumericFast ? new Map<Uint8Array, NumericValue>() : undefined;
      let retainedBytes = 0;
      const numericHuman = parsed.flags.has("h");
      const numericValueSlow = async (bytes: Uint8Array, pending: Promise<NumericValue>): Promise<NumericValue> => {
        const parsedValue = await pending;
        const charge = 6 * bytes.length + 10;
        if (numericValues!.size < 16_384 && charge <= 1_048_576 - retainedBytes) {
          numericValues!.set(bytes, parsedValue);
          retainedBytes += charge;
        }
        return parsedValue;
      };
      const numericValueSyncOrAsync = (bytes: Uint8Array): NumericValue | Promise<NumericValue> => {
        const cached = numericValues!.get(bytes);
        if (cached !== undefined) return cached;
        const charge = 6 * bytes.length + 10;
        const parsedOrPromise = parseNumeric(bytes, work, numericHuman);
        if (!(parsedOrPromise instanceof Promise)) {
          if (numericValues!.size < 16_384 && charge <= 1_048_576 - retainedBytes) {
            numericValues!.set(bytes, parsedOrPromise);
            retainedBytes += charge;
          }
          return parsedOrPromise;
        }
        return numericValueSlow(bytes, parsedOrPromise);
      };
      if (isUnkeyedNumericFast) {
        compareNumeric = async (left, right) => compareNumericValues(await numericValueSyncOrAsync(left), await numericValueSyncOrAsync(right), work);
      }
      const keyCompareGeneralAsync = async (left: Uint8Array, right: Uint8Array, checkpoint: Promise<void> | undefined): Promise<number> => {
        if (checkpoint) await checkpoint;
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
          else result = flags.has("n") || flags.has("h") ? await compareNumeric(first, second, flags.has("h")) : await compareSortBytes(first, second, work);
          if (flags.has("r")) result = -result;
          if (result) return result;
        }
        return 0;
      };
      const keyCompareSimpleAsync = async (left: Uint8Array, right: Uint8Array, checkpoint: Promise<void>): Promise<number> => {
        await checkpoint;
        return (await compareSortBytes(left, right, work)) * direction;
      };
      const compareUnkeyedNumericAsync = async (left: NumericValue | Promise<NumericValue>, right: Uint8Array, rightPending: NumericValue | Promise<NumericValue> | undefined): Promise<number> => {
        const leftValue = await left;
        const rightValue = await (rightPending ?? numericValueSyncOrAsync(right));
        return (await compareNumericValues(leftValue, rightValue, work)) * direction;
      };
      let keyCompare: (left: Uint8Array, right: Uint8Array) => number | Promise<number> = (left: Uint8Array, right: Uint8Array) => {
        const checkpoint = work.charge();
        if (simple) {
          if (checkpoint) return keyCompareSimpleAsync(left, right, checkpoint);
          const cmp = compareSortBytes(left, right, work);
          return typeof cmp === "number" ? cmp * direction : resolveScaledAfterPromise(cmp, direction);
        }
        if (isUnkeyedNumericFast && checkpoint === undefined) {
          const leftVal = numericValueSyncOrAsync(left);
          let rightVal: NumericValue | Promise<NumericValue> | undefined;
          if (!(leftVal instanceof Promise)) {
            rightVal = numericValueSyncOrAsync(right);
            if (!(rightVal instanceof Promise)) {
              const cmp = compareNumericValues(leftVal, rightVal, work);
              if (typeof cmp === "number") return cmp * direction;
              return resolveScaledAfterPromise(cmp, direction);
            }
          }
          return compareUnkeyedNumericAsync(leftVal, right, rightVal);
        }
        return keyCompareGeneralAsync(left, right, checkpoint);
      };
      const isSingleLexKeyFast = numericKey !== undefined && !["g", "h", "M", "n", "V", "f", "d", "i"].some(flag => numericKeyFlags.has(flag)) && !parsed.flags.has("c");
      if (isSingleLexKeyFast) {
        const lexRev = numericKeyFlags.has("r") ? -1 : 1;
        const lexBlanks = numericKeyFlags.has("b");
        let keyedLexSlices: Map<Uint8Array, Uint8Array> | undefined;
        const getKeyedLexSlice = (record: Uint8Array): Uint8Array | Promise<Uint8Array> => {
          const cached = keyedLexSlices?.get(record);
          if (cached !== undefined) {
            const checkpoint = work.charge(record.length);
            return checkpoint ? resolveValueAfterCheckpoint(checkpoint, cached) : cached;
          }
          const sliceOrPromise = keyBytesSync(record, numericKey, separator, lexBlanks, work);
          if (!(sliceOrPromise instanceof Promise)) {
            const map = keyedLexSlices ??= new Map();
            if (map.size < 16_384) map.set(record, sliceOrPromise);
            return sliceOrPromise;
          }
          return sliceOrPromise;
        };
        const keyCompareLexAsync = async (left: Uint8Array, right: Uint8Array, checkpoint: Promise<void> | undefined,
          firstPending: Uint8Array | Promise<Uint8Array> | undefined, secondPending: Uint8Array | Promise<Uint8Array> | undefined): Promise<number> => {
          if (checkpoint) await checkpoint;
          const first = await (firstPending ?? getKeyedLexSlice(left));
          const second = await (secondPending ?? getKeyedLexSlice(right));
          return (await compareSortBytes(first, second, work)) * lexRev;
        };
        keyCompare = (left: Uint8Array, right: Uint8Array) => {
          const checkpoint = work.charge();
          let first: Uint8Array | Promise<Uint8Array> | undefined;
          let second: Uint8Array | Promise<Uint8Array> | undefined;
          if (checkpoint === undefined) {
            first = getKeyedLexSlice(left);
            if (!(first instanceof Promise)) {
              second = getKeyedLexSlice(right);
              if (!(second instanceof Promise)) {
                const cmp = compareSortBytes(first, second, work);
                if (typeof cmp === "number") return cmp * lexRev;
                return resolveScaledAfterPromise(cmp, lexRev);
              }
            }
          }
          return keyCompareLexAsync(left, right, checkpoint, first, second);
        };
      }
      if (numericKey && (numericKeyFlags.has("n") || numericKeyFlags.has("h")) && !["b", "f", "d", "i"].some(flag => numericKeyFlags.has(flag)) && !parsed.flags.has("c")) {
        let keyedNumericValues: Map<Uint8Array, NumericValue> | undefined;
        let retainedKeyBytes = 0;
        const keyHuman = numericKeyFlags.has("h");
        const keyedNumericValueSlow = async (record: Uint8Array, bytesOrPromise: Uint8Array | Promise<Uint8Array>, parsedPending?: Promise<NumericValue>): Promise<NumericValue> => {
          const bytes = bytesOrPromise instanceof Promise ? await bytesOrPromise : bytesOrPromise;
          const charge = 6 * bytes.length + 10;
          const parsedValue = await (parsedPending ?? parseNumeric(bytes, work, keyHuman));
          const map = keyedNumericValues ??= new Map();
          if (map.size < 16_384 && charge <= 1_048_576 - retainedKeyBytes) {
            map.set(record, parsedValue);
            retainedKeyBytes += charge;
          }
          return parsedValue;
        };
        const keyedNumericValue = (record: Uint8Array): NumericValue | Promise<NumericValue> => {
          const cached = keyedNumericValues?.get(record);
          if (cached !== undefined) return cached;
          const fastParsed = keyNumericValueSync(record, numericKey, separator, false, work, keyHuman);
          if (fastParsed !== undefined) {
            const charge = 6 * lastKeyNumericLength + 10;
            const map = keyedNumericValues ??= new Map();
            if (map.size < 16_384 && charge <= 1_048_576 - retainedKeyBytes) {
              map.set(record, fastParsed);
              retainedKeyBytes += charge;
            }
            return fastParsed;
          }
          const bytesOrPromise = keyBytesSync(record, numericKey, separator, false, work);
          if (!(bytesOrPromise instanceof Promise)) {
            const charge = 6 * bytesOrPromise.length + 10;
            const parsedOrPromise = parseNumeric(bytesOrPromise, work, keyHuman);
            if (!(parsedOrPromise instanceof Promise)) {
              const map = keyedNumericValues ??= new Map();
              if (map.size < 16_384 && charge <= 1_048_576 - retainedKeyBytes) {
                map.set(record, parsedOrPromise);
                retainedKeyBytes += charge;
              }
              return parsedOrPromise;
            }
            return keyedNumericValueSlow(record, bytesOrPromise, parsedOrPromise);
          }
          return keyedNumericValueSlow(record, bytesOrPromise);
        };
        const revScale = numericKeyFlags.has("r") ? -1 : 1;
        const keyCompareNumericAsync = async (
          left: Uint8Array,
          right: Uint8Array,
          checkpoint: Promise<void> | undefined,
          leftPending: NumericValue | Promise<NumericValue> | undefined,
          rightPending: NumericValue | Promise<NumericValue> | undefined,
        ): Promise<number> => {
          if (checkpoint) await checkpoint;
          const leftVal = await (leftPending ?? keyedNumericValue(left));
          const rightVal = await (rightPending ?? keyedNumericValue(right));
          const comparison = compareNumericValues(leftVal, rightVal, work);
          const result = comparison instanceof Promise ? await comparison : comparison;
          return result * revScale;
        };
        keyCompare = (left: Uint8Array, right: Uint8Array) => {
          const checkpoint = work.charge();
          let leftPending: NumericValue | Promise<NumericValue> | undefined;
          let rightPending: NumericValue | Promise<NumericValue> | undefined;
          if (checkpoint === undefined) {
            leftPending = keyedNumericValue(left);
            if (!(leftPending instanceof Promise)) {
              rightPending = keyedNumericValue(right);
              if (!(rightPending instanceof Promise)) {
                const comparison = compareNumericValues(leftPending, rightPending, work);
                if (typeof comparison === "number") return comparison * revScale;
                return resolveScaledAfterPromise(comparison, revScale);
              }
            }
          }
          return keyCompareNumericAsync(left, right, checkpoint, leftPending, rightPending);
        };
      }
      const compareSlowAsync = async (resultPromise: Promise<number>, left: Uint8Array, right: Uint8Array): Promise<number> => {
        const resolved = await resultPromise;
        if (resolved !== 0 || skipTieFallback) return resolved;
        return (await compareSortBytes(left, right, work)) * direction;
      };
      const compare = (left: Uint8Array, right: Uint8Array): number | Promise<number> => {
        const result = keyCompare(left, right);
        if (typeof result === "number") {
          if (result !== 0 || skipTieFallback) return result;
          const fallback = compareSortBytes(left, right, work);
          return typeof fallback === "number" ? fallback * direction : resolveScaledAfterPromise(fallback, direction);
        }
        return compareSlowAsync(result, left, right);
      };
      const records: Uint8Array[] = [];
      const runs: Uint8Array[][] = [];
      const checkRecordAsync = async (bytes: Uint8Array): Promise<boolean> => {
        if (records.length && (await compare(records.at(-1)!, bytes) > 0 || parsed.flags.has("u") && await keyCompare(records.at(-1)!, bytes) === 0)) {
          if (!parsed.flags.has("C")) await diagnostic(context, new PublicDiagnostic(`disorder at record ${records.length + 1}`));
          return false;
        }
        records.push(bytes);
        return true;
      };
      for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
        const run: Uint8Array[] = [];
        if (parsed.flags.has("m")) runs.push(run);
        const targetList = parsed.flags.has("m") ? run : records;
        const acceptRecord = checking
          ? checkRecordAsync
          : (bytes: Uint8Array): void => { targetList.push(bytes); };
        try {
          const src = preReadChunks
            ? (async function* () { for (const ch of preReadChunks!) yield ch; })()
            : input(context, name);
          const complete = await collectSortRecords(src, delimiter, recordBudget, context.signal, acceptRecord);
          if (!complete) return { exitCode: 1 };
        } catch (error) { await diagnostic(context, error); return { exitCode: 2 }; }
      }
      if (checking) return { exitCode };
      const ordered = parsed.flags.has("m") ? await mergeSortRuns(runs, compare, work) : await sortRecords(records, compare, work);
      let estBytes = 0;
      let allCounted = true;
      for (let i = 0; i < ordered.length; i++) {
        estBytes += ordered[i]!.length + 1;
        if (estBytes >= 64 * 1024) { allCounted = false; break; }
      }
      if (outPath === undefined && !parsed.flags.has("u") && allCounted) {
        if (estBytes > 0) {
          const outBuf = new Uint8Array(estBytes);
          let used = 0;
          for (let i = 0; i < ordered.length; i++) {
            context.signal.throwIfAborted();
            const rec = ordered[i]!;
            outBuf.set(rec, used);
            used += rec.length;
            outBuf[used++] = delimiter;
          }
          await output(context, outBuf);
        }
        return { exitCode };
      }
      const sortBufCap = Math.min(64 * 1024, Math.max(64, estBytes));
      const sorted = (async function* (): ByteSource {
        let previous: Uint8Array | undefined;
        let buffer = new Uint8Array(sortBufCap);
        let used = 0;
        for (const record of ordered) {
          context.signal.throwIfAborted();
          if (parsed.flags.has("u") && previous !== undefined && await keyCompare(previous, record) === 0) continue;
          let offset = 0;
          if (record.length <= buffer.length - used) {
            buffer.set(record, used);
            used += record.length;
            if (used === buffer.length) { yield buffer; buffer = new Uint8Array(sortBufCap); used = 0; }
          } else {
            while (offset < record.length) {
              const length = Math.min(record.length - offset, buffer.length - used);
              buffer.set(record.subarray(offset, offset + length), used);
              offset += length; used += length;
              if (used === buffer.length) { yield buffer; buffer = new Uint8Array(sortBufCap); used = 0; }
            }
          }
          buffer[used++] = delimiter;
          if (used === buffer.length) { yield buffer; buffer = new Uint8Array(sortBufCap); used = 0; }
          previous = record;
        }
        if (used) yield buffer.subarray(0, used);
      })();
      await emitRecords(context, sorted, value(parsed, "o"));
      return { exitCode };
}

async function executeCutGeneral(context: CommandContext): Promise<{ exitCode: number }> {
      const parsed = options(context.args, "b:c:f:d:nsz", { bytes: "b", characters: "c", fields: "f", delimiter: "d", "only-delimited": "s", "zero-terminated": "z", "output-delimiter": "output-delimiter:", complement: false });
      await assertInputRequirements(context, parsed.operands);
      const modes = ["b", "c", "f"].filter(mode => parsed.flags.has(mode));
      if (modes.length !== 1) throw new UsageError("exactly one byte, character, or field list is required");
      const mode = modes[0]!;
      const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG;
      const byteSelection = mode === "b" || (mode === "c" && (locale === "C" || locale === "POSIX"));
      if (mode !== "f" && (parsed.flags.has("d") || parsed.flags.has("s"))) throw new UsageError("delimiter options require field mode");
      const work = new SortWork(context.signal);
      const ranges = await cutRanges(value(parsed, mode)!, work);
      const complement = parsed.flags.has("complement");
      const delimiter = value(parsed, "d") ?? "\t";
      if (delimiter.length !== 0 && delimiter.length !== (delimiter.codePointAt(0)! > 0xffff ? 2 : 1)) throw new UsageError("delimiter must be a single character");
      const outputDelimiter = value(parsed, "output-delimiter");
      const recordDelimiter = parsed.flags.has("z") ? 0 : 10;
      const separator = delimiter.length === 0 ? Buffer.of(0) : Buffer.from(encoder.encode(delimiter));
      const outputDelimiterBytes = outputDelimiter === undefined ? separator : outputDelimiter.length === 0 ? Uint8Array.of(0) : encoder.encode(outputDelimiter);
      const writer = new CutOutput(context, work);
      let exitCode = 0;
      try {
      for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
        try {
          try {
            const onlyDelimited = parsed.flags.has("s");
            const fastSingleByteField = mode === "f" && separator.length === 1;
            const sepByte = separator[0]!;
            const outDelimLen = outputDelimiterBytes.length;
            const processFastFieldRangeSlow = async (buf: Uint8Array, lineStart: number, lineEnd: number) => {
              context.signal.throwIfAborted();
              let boundary = buf.indexOf(sepByte, lineStart);
              if (boundary >= lineEnd) boundary = -1;
              const c0 = work.charge(boundary < 0 ? lineEnd - lineStart : boundary - lineStart + 1);
              if (c0) await c0;
              if (boundary < 0) {
                if (onlyDelimited) return;
                const w = writer.writeRange(buf, lineStart, lineEnd);
                if (w) await w;
              } else {
                let cursor = 0;
                let field = 1;
                let start = lineStart;
                let emitted = false;
                while (true) {
                  const cp = work.charge();
                  if (cp) await cp;
                  while (cursor < ranges.length && field > ranges[cursor]!.end) cursor++;
                  const included = cursor < ranges.length && field >= ranges[cursor]!.start;
                  if (included !== complement) {
                    if (emitted) {
                      const w1 = writer.write(outputDelimiterBytes);
                      if (w1) await w1;
                    }
                    const w2 = writer.writeRange(buf, start, boundary < 0 ? lineEnd : boundary);
                    if (w2) await w2;
                    emitted = true;
                  }
                  field++;
                  if (boundary < 0 || (!complement && cursor >= ranges.length)) break;
                  start = boundary + 1;
                  boundary = start <= lineEnd ? buf.indexOf(sepByte, start) : -1;
                  if (boundary >= lineEnd) boundary = -1;
                  const cn = work.charge(boundary < 0 ? lineEnd - start : boundary - start + 1);
                  if (cn) await cn;
                }
              }
              const wd = writer.writeByte(recordDelimiter);
              if (wd) await wd;
            };
            const processFastFieldRange = (buf: Uint8Array, lineStart: number, lineEnd: number): Promise<void> | undefined => {
              const lineLen = lineEnd - lineStart;
              if (writer.remaining <= lineLen * (outDelimLen > 1 ? outDelimLen : 1) + 1) {
                return processFastFieldRangeSlow(buf, lineStart, lineEnd);
              }
              context.signal.throwIfAborted();
              let boundary = buf.indexOf(sepByte, lineStart);
              if (boundary >= lineEnd) boundary = -1;
              let totalCharge = boundary < 0 ? lineLen : boundary - lineStart + 1;
              if (boundary < 0) {
                if (onlyDelimited) return work.charge(totalCharge);
                totalCharge += writer.writeRangeUncharged(buf, lineStart, lineEnd);
              } else {
                let cursor = 0;
                let field = 1;
                let start = lineStart;
                let emitted = false;
                while (true) {
                  totalCharge += 1;
                  while (cursor < ranges.length && field > ranges[cursor]!.end) cursor++;
                  const included = cursor < ranges.length && field >= ranges[cursor]!.start;
                  if (included !== complement) {
                    if (emitted) {
                      totalCharge += writer.writeRangeUncharged(outputDelimiterBytes, 0, outDelimLen);
                    }
                    totalCharge += writer.writeRangeUncharged(buf, start, boundary < 0 ? lineEnd : boundary);
                    emitted = true;
                  }
                  field++;
                  if (boundary < 0 || (!complement && cursor >= ranges.length)) break;
                  start = boundary + 1;
                  boundary = start <= lineEnd ? buf.indexOf(sepByte, start) : -1;
                  if (boundary >= lineEnd) boundary = -1;
                  totalCharge += boundary < 0 ? lineEnd - start : boundary - start + 1;
                }
              }
              writer.writeByteUncharged(recordDelimiter);
              totalCharge += 1;
              return work.charge(totalCharge);
            };
            const processLineBytes = async (lineBytes: Uint8Array) => {
              context.signal.throwIfAborted();
              let cursor = 0;
              const selected = (position: number) => {
                while (cursor < ranges.length && position > ranges[cursor]!.end) cursor++;
                const included = cursor < ranges.length && position >= ranges[cursor]!.start;
                return included !== complement ? cursor : -1;
              };
              if (mode === "f") {
                const record = Buffer.from(lineBytes.buffer, lineBytes.byteOffset, lineBytes.byteLength);
                const b0 = cutFieldBoundary(record, separator, 0, work);
                let boundary = typeof b0 === "number" ? b0 : await b0;
                if (boundary < 0) {
                  if (onlyDelimited) return;
                  const w = writer.write(lineBytes);
                  if (w) await w;
                } else {
                  let field = 1;
                  let start = 0;
                  let emitted = false;
                  while (true) {
                    const checkpoint = work.charge();
                    if (checkpoint) await checkpoint;
                    if (selected(field++) >= 0) {
                      if (emitted) {
                        const w1 = writer.write(outputDelimiterBytes);
                        if (w1) await w1;
                      }
                      const w2 = writer.write(record.subarray(start, boundary < 0 ? record.length : boundary));
                      if (w2) await w2;
                      emitted = true;
                    }
                    if (boundary < 0 || (!complement && cursor >= ranges.length)) break;
                    start = boundary + separator.length;
                    const bn = cutFieldBoundary(record, separator, start, work);
                    boundary = typeof bn === "number" ? bn : await bn;
                  }
                }
              } else if (byteSelection) {
                let emitted = false;
                let previousRange = -1;
                for (let offset = 0; offset < lineBytes.length; offset += 4096) {
                  const end = Math.min(lineBytes.length, offset + 4096);
                  const checkpoint = work.charge(end - offset);
                  if (checkpoint) await checkpoint;
                  let start = -1;
                  for (let index = offset; index < end; index++) {
                    const range = selected(index + 1);
                    if (range !== previousRange && start >= 0) { await writer.write(lineBytes.subarray(start, index)); start = -1; }
                    if (range >= 0 && start < 0) {
                      if (range !== previousRange && emitted && outputDelimiter !== undefined) await writer.write(outputDelimiterBytes);
                      start = index;
                      emitted = true;
                    }
                    previousRange = range;
                  }
                  if (start >= 0) await writer.write(lineBytes.subarray(start, end));
                }
              } else {
                const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
                let index = 0;
                let emitted = false;
                let previousRange = -1;
                for (let offset = 0; offset < lineBytes.length; offset += 4096) {
                  const end = Math.min(lineBytes.length, offset + 4096);
                  const checkpoint = work.charge(end - offset);
                  if (checkpoint) await checkpoint;
                  const text = decoder.decode(lineBytes.subarray(offset, end), { stream: end < lineBytes.length });
                  let start = -1;
                  let position = 0;
                  for (const character of text) {
                    const checkpoint = work.charge();
                    if (checkpoint) await checkpoint;
                    const range = selected(++index);
                    if (range !== previousRange && start >= 0) { await writer.text(text.slice(start, position)); start = -1; }
                    if (range >= 0 && start < 0) {
                      if (range !== previousRange && emitted && outputDelimiter !== undefined) await writer.write(outputDelimiterBytes);
                      start = position;
                      emitted = true;
                    }
                    position += character.length;
                    previousRange = range;
                  }
                  if (start >= 0) await writer.text(text.slice(start));
                }
              }
              const wd = writer.writeByte(recordDelimiter);
              if (wd) await wd;
            };
            const pending = new RecordBuffer(bufferLimit);
            try {
              for await (const chunk of input(context, name)) {
                let start = 0;
                while (start < chunk.length) {
                  const offset = chunk.indexOf(recordDelimiter, start);
                  if (offset < 0) break;
                  if (fastSingleByteField && pending.size === 0 && offset - start <= 4096) {
                    const p = processFastFieldRange(chunk, start, offset);
                    if (p) await p;
                  } else {
                    await processLineBytes(pending.finish(undefined, chunk, start, offset));
                  }
                  start = offset + 1;
                }
                pending.append(chunk, start);
              }
              if (pending.size) {
                const finalBytes = pending.finish();
                if (fastSingleByteField && finalBytes.length <= 4096) {
                  const p = processFastFieldRange(finalBytes, 0, finalBytes.length);
                  if (p) await p;
                } else {
                  await processLineBytes(finalBytes);
                }
              }
            } finally {
              pending.clear();
            }
          } finally {
            await writer.flush();
          }
        } catch (error) { await diagnostic(context, error); exitCode = 1; }
      }
      } finally {
        writer.release();
      }
      return { exitCode };
}

const syncResolved = Symbol.for("safe-bash.syncResolved");
function isSyncResolved(promise: unknown): boolean {
  return Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

async function executeUniqGeneral(context: CommandContext, preReadSource?: ByteSource): Promise<{ exitCode: number }> {
  let ended = false;
  let repeatedMethod = "none";
  let groupMethod: string | undefined;
  const args = context.args.map(argument => {
    if (ended) return argument;
    if (argument === "--") ended = true;
    if (argument === "--all-repeated") return "--all-repeated=none";
    if (argument === "--group") return "--group=separate";
    return argument;
  });
  const parsed = options(args, "cduiDf:s:w:z", { count: "c", repeated: "d", unique: "u", "all-repeated": "all-repeated:", group: "group:", "ignore-case": "i", "skip-fields": "f", "skip-chars": "s", "check-chars": "w", "zero-terminated": "z" }, false, undefined, undefined, (option, method) => {
    if (option === "D") repeatedMethod = "none";
    else if (option === "all-repeated") {
      if (!["none", "prepend", "separate"].includes(method!)) throw new UsageError(`invalid argument '${method}' for 'all-repeated'`);
      repeatedMethod = method!;
    } else if (option === "group") {
      if (!["separate", "prepend", "append", "both"].includes(method!)) throw new UsageError(`invalid argument '${method}' for 'group'`);
      groupMethod = method;
    }
  });
  const allRepeated = parsed.flags.has("D") || parsed.flags.has("all-repeated");
  if (allRepeated && parsed.flags.has("c")) throw new UsageError("printing all duplicated lines and repeat counts is meaningless");
  if (groupMethod !== undefined && (allRepeated || ["c", "d", "u"].some(flag => parsed.flags.has(flag)))) throw new UsageError("--group is mutually exclusive with -c/-d/-D/-u");
  requireOperands(parsed.operands, 0, 2);
  await assertInputRequirements(context, parsed.operands.slice(0, 1));
  await admitTextOutput(context, parsed.operands[1]);
  if (parsed.operands[1] !== undefined && parsed.operands[0] !== "-") {
    const source = pathOf(context, parsed.operands[0]!);
    const destination = pathOf(context, parsed.operands[1]);
    const sourceStat = await context.fs.stat(source, { signal: context.signal });
    let destinationStat;
    try { destinationStat = await context.fs.stat(destination, { signal: context.signal }); }
    catch (error) { context.signal.throwIfAborted(); if (codeOf(error) !== "ENOENT") throw error; }
    if (destinationStat) {
      const samePath = await context.fs.realpath(source, { signal: context.signal }) === await context.fs.realpath(destination, { signal: context.signal });
      const identity = samePath ? "same" : await compareObservedEntries(context.fs, source, sourceStat, context.fs, destination, destinationStat, { signal: context.signal });
      if (identity === "same") throw new UsageError("input and output must be different files");
      if (identity === "unknown") throw new FsError("ENOTSUP", { syscall: "uniq", path: source, dest: destination, message: "cannot determine whether input and output are distinct files" });
    }
  }
  const skipFields = integer(value(parsed, "f") ?? "0");
  const skipCharacters = integer(value(parsed, "s") ?? "0");
  const width = value(parsed, "w") === undefined ? Infinity : integer(value(parsed, "w")!);
  const delimiter = parsed.flags.has("z") ? 0 : 10;
  const ignoreCase = parsed.flags.has("i");
  const hasCount = parsed.flags.has("c");
  const onlyRepeated = parsed.flags.has("d");
  const onlyUnique = parsed.flags.has("u");
  const identityKey = skipFields === 0 && skipCharacters === 0 && width === Infinity && !ignoreCase;
  const key = (bytes: Uint8Array) => {
    if (identityKey) return bytes;
    let offset = 0;
    for (let field = 0; field < skipFields; field++) {
      while (offset < bytes.length && (bytes[offset] === 32 || bytes[offset] === 9)) offset++;
      while (offset < bytes.length && bytes[offset] !== 32 && bytes[offset] !== 9) offset++;
    }
    offset += skipCharacters;
    const result = bytes.subarray(offset, width === Infinity ? undefined : offset + width);
    return ignoreCase ? fold(result) : result;
  };
  const records = (async function* (): ByteSource {
    let previous: Uint8Array | undefined;
    let previousKey: Uint8Array | undefined;
    let count = 0;
    let emittedGroup = false;
    const expanded = allRepeated || groupMethod !== undefined;
    const method = groupMethod ?? repeatedMethod;
    const selected = () => (!onlyRepeated || count > 1) && (!onlyUnique || count === 1);
    const outCap = 65536;
    let outBuf = new Uint8Array(outCap);
    let outUsed = 0;
    const flushChunks: Uint8Array[] = [];
    const writeBytes = (bytes: Uint8Array) => {
      let offset = 0;
      while (offset < bytes.length) {
        const avail = outBuf.length - outUsed;
        const take = Math.min(avail, bytes.length - offset);
        outBuf.set(bytes.subarray(offset, offset + take), outUsed);
        outUsed += take;
        offset += take;
        if (outUsed === outBuf.length) {
          flushChunks.push(outBuf);
          outBuf = new Uint8Array(outCap);
          outUsed = 0;
        }
      }
    };
    const writeByte = (b: number) => {
      outBuf[outUsed++] = b;
      if (outUsed === outBuf.length) {
        flushChunks.push(outBuf);
        outBuf = new Uint8Array(outCap);
        outUsed = 0;
      }
    };
    const emitLine = (lineBytes: Uint8Array) => {
      if (hasCount) writeUniqCountBytes(writeByte, count);
      writeBytes(lineBytes);
      writeByte(delimiter);
    };
    const processLine = (lineBytes: Uint8Array) => {
      context.signal.throwIfAborted();
      const currentKey = key(lineBytes);
      if (previousKey && compareBytes(previousKey, currentKey) === 0) {
        count++;
        if (expanded && !onlyUnique) {
          if (allRepeated && count === 2) {
            if (method === "prepend" || (method === "separate" && emittedGroup)) writeByte(delimiter);
            emitLine(previous!);
            emittedGroup = true;
          }
          writeBytes(lineBytes);
          writeByte(delimiter);
        }
      } else {
        if (!expanded && previous !== undefined && selected()) emitLine(previous);
        previous = lineBytes;
        previousKey = currentKey;
        count = 1;
        if (groupMethod !== undefined) {
          if (method === "prepend" || method === "both" || emittedGroup) writeByte(delimiter);
          emitLine(previous);
          emittedGroup = true;
        }
      }
    };
    const pending = new RecordBuffer(bufferLimit);
    try {
      for await (const chunk of (preReadSource ?? input(context, parsed.operands[0]))) {
        let start = 0;
        while (start < chunk.length) {
          const offset = chunk.indexOf(delimiter, start);
          if (offset < 0) break;
          const lineBytes = pending.size === 0 ? chunk.subarray(start, offset) : pending.finish(undefined, chunk, start, offset);
          if (lineBytes.length > bufferLimit) throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
          processLine(lineBytes);
          while (flushChunks.length) yield flushChunks.shift()!;
          start = offset + 1;
        }
        if (previous && pending.size === 0 && previous.buffer === chunk.buffer) {
          previous = previous.slice();
          if (identityKey) previousKey = previous;
        }
        pending.append(chunk, start);
      }
      if (pending.size) {
        processLine(pending.finish(undefined));
        while (flushChunks.length) yield flushChunks.shift()!;
      }
    } finally {
      pending.clear();
    }
    if (!expanded && previous !== undefined && selected()) emitLine(previous);
    if (emittedGroup && (method === "append" || method === "both")) writeByte(delimiter);
    while (flushChunks.length) yield flushChunks.shift()!;
    if (outUsed > 0) yield outBuf.subarray(0, outUsed);
  })();
  await emitRecords(context, records, parsed.operands[1]);
  return { exitCode: 0 };
}

export function textCommands(): CommandDefinition[] {
  return [
    define("sort", context => {
      if (
        (context.args.length === 0 || (context.args.length === 1 && context.args[0] === "-r")) &&
        !hasYieldCheckpoint(context.signal) &&
        SortRecordBudget.prototype.admit === defaultSortAdmit &&
        Uint8Array === defaultUint8Array
      ) {
        const direction = context.args.length === 1 ? -1 : 1;
        const req = assertInputRequirements(context, EMPTY_OPERANDS);
        if (req) return executeSortFastAsync(context, direction, req);
        const srcIter = input(context, "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
          tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
        };
        if (typeof srcIter.tryNextSync === "function") {
          let res1: IteratorResult<Uint8Array> | undefined;
          try {
            res1 = srcIter.tryNextSync();
          } catch (error) {
            return diagnostic(context, error).then(() => ({ exitCode: 2 }));
          }
          if (res1 !== undefined) {
            if (res1.done) return RESOLVED_EXIT_ZERO;
            const firstChunk = res1.value;
            let res2: IteratorResult<Uint8Array> | undefined;
            try {
              res2 = srcIter.tryNextSync();
            } catch (error) {
              return diagnostic(context, error).then(() => ({ exitCode: 2 }));
            }
            if (
              res2 !== undefined &&
              res2.done &&
              firstChunk.length > 0 &&
              firstChunk.length <= 65536 &&
              firstChunk[firstChunk.length - 1] === 10
            ) {
              let start = 0;
              let count = 0;
              let validLines = true;
              while (start < firstChunk.length) {
                const offset = firstChunk.indexOf(10, start);
                if (offset < 0 || count >= 4096 || offset - start > bufferLimit) {
                  validLines = false;
                  break;
                }
                sharedSortStarts[count] = start;
                sharedSortEnds[count] = offset;
                sharedSortIndices[count] = count;
                count++;
                start = offset + 1;
              }
              if (validLines) {
                context.signal.throwIfAborted();
                let src = sharedSortIndices;
                let dst = sharedSortScratchIndices;
                for (let width = 1; width < count; width *= 2) {
                  context.signal.throwIfAborted();
                  for (let begin = 0; begin < count; begin += width * 2) {
                    const middle = Math.min(begin + width, count);
                    const end = Math.min(begin + width * 2, count);
                    let left = begin;
                    let right = middle;
                    for (let index = begin; index < end; index++) {
                      if (left < middle) {
                        if (right === end) {
                          dst[index] = src[left++]!;
                          continue;
                        }
                        const a = src[left]!;
                        const b = src[right]!;
                        if (
                          compareChunkSliceBytes(
                            firstChunk,
                            sharedSortStarts[a]!,
                            sharedSortEnds[a]!,
                            sharedSortStarts[b]!,
                            sharedSortEnds[b]!,
                          ) * direction <= 0
                        ) {
                          dst[index] = src[left++]!;
                          continue;
                        }
                      }
                      dst[index] = src[right++]!;
                    }
                  }
                  const tmp = src;
                  src = dst;
                  dst = tmp;
                }
                const outBuf = sharedSortOutScratch.subarray(0, firstChunk.length);
                let used = 0;
                for (let i = 0; i < count; i++) {
                  const idx = src[i]!;
                  const s = sharedSortStarts[idx]!;
                  const e = sharedSortEnds[idx]!;
                  for (let p = s; p < e; p++) outBuf[used++] = firstChunk[p]!;
                  outBuf[used++] = 10;
                }
                const syncSink = !(context.stdout as { isPipeStage?: boolean }).isPipeStage
                  ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
                  : undefined;
                if (typeof syncSink?.writeSync === "function" && syncSink.writeSync(outBuf) !== false) {
                  return RESOLVED_EXIT_ZERO;
                }
                const p = output(context, outBuf);
                if (isSyncResolved(p)) return RESOLVED_EXIT_ZERO;
                return p.then(() => ({ exitCode: 0 }));
              }
            }
            return executeSortFastContinueAsync(context, direction, srcIter, firstChunk, res2);
          }
        }
        return executeSortFastContinueAsync(context, direction, srcIter, undefined, undefined);
      }
      return executeSortGeneral(context);
    }),
    define("uniq", context => {
      if (!hasYieldCheckpoint(context.signal)) {
        let fastHasCount = false;
        let fastOnlyRepeated = false;
        let fastOnlyUnique = false;
        let fastIgnoreCase = false;
        let canFast = true;
        for (let i = 0; i < context.args.length; i++) {
          const a = context.args[i]!;
          if (a.length < 2 || a.charCodeAt(0) !== 45 || a.charCodeAt(1) === 45) {
            canFast = false;
            break;
          }
          for (let j = 1; j < a.length; j++) {
            const ch = a.charCodeAt(j);
            if (ch === 99) fastHasCount = true;
            else if (ch === 100) fastOnlyRepeated = true;
            else if (ch === 117) fastOnlyUnique = true;
            else if (ch === 105) fastIgnoreCase = true;
            else {
              canFast = false;
              break;
            }
          }
          if (!canFast) break;
        }
        if (canFast && !assertInputRequirements(context, EMPTY_OPERANDS)) {
          const srcIter = input(context, "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
            tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
          };
          if (typeof srcIter.tryNextSync === "function") {
            let res1: IteratorResult<Uint8Array> | undefined;
            try {
              res1 = srcIter.tryNextSync();
            } catch (error) {
              return diagnostic(context, error).then(() => ({ exitCode: 1 }));
            }
            if (res1 !== undefined) {
              if (res1.done) return RESOLVED_EXIT_ZERO;
              const chunk = res1.value;
              let res2: IteratorResult<Uint8Array> | undefined;
              try {
                res2 = srcIter.tryNextSync();
              } catch (error) {
                return diagnostic(context, error).then(() => ({ exitCode: 1 }));
              }
              if (res2 !== undefined && res2.done && chunk.length <= 65536) {
                const outBuf = sharedUniqOutBuffer;
                let outUsed = 0;
                let prevStart = -1;
                let prevEnd = -1;
                let count = 0;
                const emitFast = () => {
                  if ((fastOnlyRepeated && count <= 1) || (fastOnlyUnique && count !== 1)) return true;
                  const lineLen = prevEnd - prevStart;
                  if (outUsed + lineLen + 18 > outBuf.length) return false;
                  if (fastHasCount) {
                    const digits = String(count);
                    const pad = 7 - digits.length;
                    for (let k = 0; k < pad; k++) outBuf[outUsed++] = 32;
                    for (let k = 0; k < digits.length; k++) outBuf[outUsed++] = digits.charCodeAt(k);
                    outBuf[outUsed++] = 32;
                  }
                  for (let k = prevStart; k < prevEnd; k++) outBuf[outUsed++] = chunk[k]!;
                  outBuf[outUsed++] = 10;
                  return true;
                };
                let start = 0;
                let fits = true;
                while (start < chunk.length) {
                  let offset = chunk.indexOf(10, start);
                  if (offset < 0) offset = chunk.length;
                  context.signal.throwIfAborted();
                  const lineLen = offset - start;
                  let same = false;
                  if (prevStart >= 0 && prevEnd - prevStart === lineLen) {
                    same = true;
                    if (fastIgnoreCase) {
                      for (let k = 0; k < lineLen; k++) {
                        const a = chunk[prevStart + k]!;
                        const b = chunk[start + k]!;
                        const fa = a >= 97 && a <= 122 ? a - 32 : a;
                        const fb = b >= 97 && b <= 122 ? b - 32 : b;
                        if (fa !== fb) { same = false; break; }
                      }
                    } else {
                      for (let k = 0; k < lineLen; k++) {
                        if (chunk[prevStart + k] !== chunk[start + k]) { same = false; break; }
                      }
                    }
                  }
                  if (same) {
                    count++;
                  } else {
                    if (prevStart >= 0 && !emitFast()) { fits = false; break; }
                    prevStart = start;
                    prevEnd = offset;
                    count = 1;
                  }
                  start = offset + 1;
                }
                if (fits && (prevStart < 0 || emitFast())) {
                  if (outUsed === 0) return RESOLVED_EXIT_ZERO;
                  const isPipeStage = Boolean((context.stdout as { isPipeStage?: boolean }).isPipeStage);
                  const syncSink = !isPipeStage
                    ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
                    : undefined;
                  if (typeof syncSink?.writeSync === "function" && syncSink.writeSync(outBuf.subarray(0, outUsed)) !== false) {
                    return RESOLVED_EXIT_ZERO;
                  }
                  const bytes = isPipeStage ? outBuf.subarray(0, outUsed) : outBuf.slice(0, outUsed);
                  const p = output(context, bytes);
                  if (isSyncResolved(p)) return RESOLVED_EXIT_ZERO;
                  return p.then(() => ({ exitCode: 0 }));
                }
              }
              return executeUniqGeneral(context, (async function* () {
                yield chunk;
                if (res2 && !res2.done) yield res2.value;
                while (true) {
                  const next = await srcIter.next();
                  if (next.done) break;
                  yield next.value;
                }
              })());
            }
          }
        }
      }
      return executeUniqGeneral(context);
    }),
    define("cut", context => {
      if (!hasYieldCheckpoint(context.signal)) {
        const args = context.args;
        let sepByte = 9;
        let targetField = 0;
        let operand: string | undefined;
        let canFast = args.length >= 1 && args.length <= 5;
        if (canFast) {
          for (let i = 0; i < args.length; i++) {
            const a = args[i]!;
            if (a.length >= 2 && a.charCodeAt(0) === 45) {
              const opt = a.charCodeAt(1);
              if (opt === 100) {
                const val = a.length > 2 ? a.slice(2) : args[++i];
                if (val === undefined || val.length !== 1 || val.charCodeAt(0) >= 128) {
                  canFast = false;
                  break;
                }
                sepByte = val.charCodeAt(0);
              } else if (opt === 102) {
                const val = a.length > 2 ? a.slice(2) : args[++i];
                if (!val || targetField > 0) {
                  canFast = false;
                  break;
                }
                let num = 0;
                for (let j = 0; j < val.length; j++) {
                  const c = val.charCodeAt(j) - 48;
                  if (c < 0 || c > 9 || num > 100000) {
                    num = 0;
                    break;
                  }
                  num = num * 10 + c;
                }
                if (num < 1) {
                  canFast = false;
                  break;
                }
                targetField = num;
              } else {
                canFast = false;
                break;
              }
            } else if (operand === undefined) {
              operand = a;
            } else {
              canFast = false;
              break;
            }
          }
        }
        if (canFast && targetField >= 1) {
          const req = assertInputRequirements(context, operand !== undefined ? [operand] : EMPTY_OPERANDS);
          if (!req && operand === undefined && !sharedCutOutInUse) {
            const srcIter = input(context, "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
              tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
            };
            if (typeof srcIter.tryNextSync === "function") {
              let res1: IteratorResult<Uint8Array> | undefined;
              try {
                res1 = srcIter.tryNextSync();
              } catch (error) {
                return diagnostic(context, error).then(() => ({ exitCode: 1 }));
              }
              if (res1 !== undefined) {
                if (res1.done) return RESOLVED_EXIT_ZERO;
                const chunk = res1.value;
                let res2: IteratorResult<Uint8Array> | undefined;
                try {
                  res2 = srcIter.tryNextSync();
                } catch (error) {
                  return diagnostic(context, error).then(() => ({ exitCode: 1 }));
                }
                if (res2 !== undefined && res2.done && chunk.length < sharedCutOutBuffer.length) {
                  const outBuf = sharedCutOutBuffer;
                  let outUsed = 0;
                  let start = 0;
                  while (start < chunk.length) {
                    let offset = chunk.indexOf(10, start);
                    const hasNewline = offset >= 0;
                    if (!hasNewline) {
                      if (chunk.length - start > bufferLimit) {
                        return diagnostic(context, new FsError("EFBIG", { message: `record length exceeds ${bufferLimit} bytes` })).then(() => ({ exitCode: 1 }));
                      }
                      offset = chunk.length;
                    }
                    context.signal.throwIfAborted();
                    let boundary = chunk.indexOf(sepByte, start);
                    if (boundary >= offset) boundary = -1;
                    let fStart = start;
                    let fEnd = offset;
                    if (boundary >= 0) {
                      let f = 1;
                      while (f < targetField && boundary >= 0) {
                        fStart = boundary + 1;
                        boundary = fStart <= offset ? chunk.indexOf(sepByte, fStart) : -1;
                        if (boundary >= offset) boundary = -1;
                        f++;
                      }
                      if (f < targetField) {
                        fStart = offset;
                        fEnd = offset;
                      } else {
                        fEnd = boundary < 0 ? offset : boundary;
                      }
                    }
                    for (let index = fStart; index < fEnd; index++) outBuf[outUsed++] = chunk[index]!;
                    outBuf[outUsed++] = 10;
                    start = offset + 1;
                  }
                  if (outUsed === 0) return RESOLVED_EXIT_ZERO;
                  const isPipeStage = Boolean((context.stdout as { isPipeStage?: boolean }).isPipeStage);
                  const syncSink = !isPipeStage
                    ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
                    : undefined;
                  if (typeof syncSink?.writeSync === "function" && syncSink.writeSync(outBuf.subarray(0, outUsed)) !== false) {
                    return RESOLVED_EXIT_ZERO;
                  }
                  const bytes = isPipeStage ? outBuf.subarray(0, outUsed) : outBuf.slice(0, outUsed);
                  const p = output(context, bytes);
                  if (isSyncResolved(p)) return RESOLVED_EXIT_ZERO;
                  return p.then(() => ({ exitCode: 0 }));
                }
                return executeCutFastAsync(context, operand, sepByte, targetField, req, srcIter, chunk, res2);
              }
              return executeCutFastAsync(context, operand, sepByte, targetField, req, srcIter, undefined, undefined);
            }
          }
          return executeCutFastAsync(context, operand, sepByte, targetField, req, undefined, undefined, undefined);
        }
      }
      return executeCutGeneral(context);
    }),
  ].map(command => ({ ...command, filesystemRequirements: command.name === "cut" ? inputRequirements : textOutputRequirements }));
}

async function executeSortFastAsync(
  context: CommandContext,
  direction: number,
  req: Promise<void>,
): Promise<{ exitCode: number }> {
  await req;
  await admitTextOutput(context, undefined);
  const srcIter = input(context, "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
  };
  return executeSortFastContinueAsync(context, direction, srcIter, undefined, undefined);
}

async function executeSortFastContinueAsync(
  context: CommandContext,
  direction: number,
  srcIter: AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined },
  initialFirstChunk: Uint8Array | undefined,
  initialSecondRes: IteratorResult<Uint8Array> | undefined,
): Promise<{ exitCode: number }> {
        let firstChunk: Uint8Array | undefined = initialFirstChunk && initialFirstChunk.length > 0 ? initialFirstChunk : undefined;
        let moreChunks: Uint8Array[] | undefined;
        let totalChunkBytes = firstChunk ? firstChunk.length : 0;
        if (initialSecondRes && !initialSecondRes.done && initialSecondRes.value.length > 0) {
          totalChunkBytes += initialSecondRes.value.length;
          if (!firstChunk) firstChunk = initialSecondRes.value;
          else moreChunks = [firstChunk, initialSecondRes.value];
        }
        try {
          while (!initialSecondRes?.done) {
            const syncRes = srcIter.tryNextSync?.();
            const res = syncRes !== undefined ? syncRes : await srcIter.next();
            if (res.done) break;
            const ch = res.value;
            if (ch.length === 0) continue;
            totalChunkBytes += ch.length;
            if (!firstChunk) firstChunk = ch;
            else (moreChunks ??= [firstChunk]).push(ch);
          }
        } catch (error) {
          await diagnostic(context, error);
          return { exitCode: 2 };
        }
        if (!firstChunk) return { exitCode: 0 };
        if (moreChunks && totalChunkBytes <= 65536) {
          let pos = 0;
          for (let i = 0; i < moreChunks.length; i++) {
            const c = moreChunks[i]!;
            sharedSortInScratch.set(c, pos);
            pos += c.length;
          }
          firstChunk = sharedSortInScratch.subarray(0, totalChunkBytes);
          moreChunks = undefined;
        }
        if (
          !moreChunks &&
          firstChunk.length <= 65536 &&
          firstChunk[firstChunk.length - 1] === 10
        ) {
          let start = 0;
          let count = 0;
          let validLines = true;
          while (start < firstChunk.length) {
            const offset = firstChunk.indexOf(10, start);
            if (offset < 0 || count >= 4096 || offset - start > bufferLimit) {
              validLines = false;
              break;
            }
            sharedSortStarts[count] = start;
            sharedSortEnds[count] = offset;
            sharedSortIndices[count] = count;
            count++;
            start = offset + 1;
          }
          if (validLines) {
            context.signal.throwIfAborted();
            let src = sharedSortIndices;
            let dst = sharedSortScratchIndices;
            for (let width = 1; width < count; width *= 2) {
              context.signal.throwIfAborted();
              for (let begin = 0; begin < count; begin += width * 2) {
                const middle = Math.min(begin + width, count);
                const end = Math.min(begin + width * 2, count);
                let left = begin;
                let right = middle;
                for (let index = begin; index < end; index++) {
                  if (left < middle) {
                    if (right === end) {
                      dst[index] = src[left++]!;
                      continue;
                    }
                    const a = src[left]!;
                    const b = src[right]!;
                    if (
                      compareChunkSliceBytes(
                        firstChunk,
                        sharedSortStarts[a]!,
                        sharedSortEnds[a]!,
                        sharedSortStarts[b]!,
                        sharedSortEnds[b]!,
                      ) * direction <= 0
                    ) {
                      dst[index] = src[left++]!;
                      continue;
                    }
                  }
                  dst[index] = src[right++]!;
                }
              }
              const tmp = src;
              src = dst;
              dst = tmp;
            }
            const outBuf = sharedSortOutScratch.subarray(0, firstChunk.length);
            let used = 0;
            for (let i = 0; i < count; i++) {
              const idx = src[i]!;
              const s = sharedSortStarts[idx]!;
              const e = sharedSortEnds[idx]!;
              for (let p = s; p < e; p++) outBuf[used++] = firstChunk[p]!;
              outBuf[used++] = 10;
            }
            const syncSink = !(context.stdout as { isPipeStage?: boolean }).isPipeStage
              ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
              : undefined;
            if (typeof syncSink?.writeSync === "function" && syncSink.writeSync(outBuf) !== false) {
              return { exitCode: 0 };
            }
            await output(context, outBuf);
            return { exitCode: 0 };
          }
          if (firstChunk.buffer === sharedSortInScratch.buffer) {
            firstChunk = new Uint8Array(firstChunk);
          }
        }
        return executeSortGeneral(context, moreChunks ?? [firstChunk]);
}

async function executeCutFastAsync(
  context: CommandContext,
  operand: string | undefined,
  sepByte: number,
  targetField: number,
  req: void | Promise<void> | undefined,
  existingIter: (AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined }) | undefined,
  initialFirstChunk: Uint8Array | undefined,
  initialSecondRes: IteratorResult<Uint8Array> | undefined,
): Promise<{ exitCode: number }> {
          if (req) await req;
          const ownsShared = !sharedCutOutInUse;
          if (ownsShared) sharedCutOutInUse = true;
          const outBuf = ownsShared ? sharedCutOutBuffer : new Uint8Array(65536);
          let outUsed = 0;
          const isPipeStage = Boolean((context.stdout as { isPipeStage?: boolean }).isPipeStage);
          const syncSink = !isPipeStage
            ? (context.stdout as { writeSync?: (chunk: Uint8Array) => boolean })
            : undefined;
          const canWriteSync = typeof syncSink?.writeSync === "function";
          const flush = (): Promise<void> | undefined => {
            if (outUsed === 0) return;
            context.signal.throwIfAborted();
            if (canWriteSync && syncSink!.writeSync!(outBuf.subarray(0, outUsed)) !== false) {
              outUsed = 0;
              context.signal.throwIfAborted();
              return;
            }
            const bytes = isPipeStage ? outBuf.subarray(0, outUsed) : outBuf.slice(0, outUsed);
            outUsed = 0;
            const p = output(context, bytes);
            return isSyncResolved(p) ? undefined : p;
          };
          const writeFieldSlow = async (chunk: Uint8Array, start: number, end: number): Promise<void> => {
            if (outUsed === outBuf.length) {
              const pending = flush();
              if (pending) await pending;
            }
            while (start < end) {
              const length = Math.min(end - start, outBuf.length - outUsed);
              outBuf.set(chunk.subarray(start, start + length), outUsed);
              start += length;
              outUsed += length;
              if (outUsed === outBuf.length) {
                const pending = flush();
                if (pending) await pending;
              }
            }
            outBuf[outUsed++] = 10;
          };
          const writeField = (chunk: Uint8Array, start: number, end: number): Promise<void> | undefined => {
            if (outUsed + end - start + 1 > outBuf.length) return writeFieldSlow(chunk, start, end);
            for (let index = start; index < end; index++) outBuf[outUsed++] = chunk[index]!;
            outBuf[outUsed++] = 10;
          };
          let leftover: Uint8Array | undefined;
          try {
            const srcIter = existingIter ?? (input(context, operand ?? "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
              tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
            });
            let stepIndex = 0;
            while (true) {
              let res: IteratorResult<Uint8Array>;
              if (stepIndex === 0 && initialFirstChunk !== undefined) {
                stepIndex = 1;
                res = { done: false, value: initialFirstChunk };
              } else if (stepIndex === 1 && initialSecondRes !== undefined) {
                stepIndex = 2;
                res = initialSecondRes;
              } else {
                stepIndex = 2;
                const syncRes = srcIter.tryNextSync?.();
                res = syncRes !== undefined ? syncRes : await srcIter.next();
              }
              if (res.done) break;
              let chunk = res.value;
              if (chunk.length === 0) continue;
              if (leftover && leftover.length > 0) {
                const combined = new Uint8Array(leftover.length + chunk.length);
                combined.set(leftover, 0);
                combined.set(chunk, leftover.length);
                chunk = combined;
                leftover = undefined;
              }
              let start = 0;
              while (start < chunk.length) {
                const offset = chunk.indexOf(10, start);
                if (offset < 0) break;
                context.signal.throwIfAborted();
                let boundary = chunk.indexOf(sepByte, start);
                if (boundary >= offset) boundary = -1;
                let fStart = start;
                let fEnd = offset;
                if (boundary >= 0) {
                  let f = 1;
                  while (f < targetField && boundary >= 0) {
                    fStart = boundary + 1;
                    boundary = fStart <= offset ? chunk.indexOf(sepByte, fStart) : -1;
                    if (boundary >= offset) boundary = -1;
                    f++;
                  }
                  if (f < targetField) {
                    fStart = offset;
                    fEnd = offset;
                  } else {
                    fEnd = boundary < 0 ? offset : boundary;
                  }
                }
                const pending = writeField(chunk, fStart, fEnd);
                if (pending) await pending;
                start = offset + 1;
              }
              if (start < chunk.length) {
                if (chunk.length - start > bufferLimit) {
                  throw new FsError("EFBIG", { message: `record length exceeds ${bufferLimit} bytes` });
                }
                leftover = chunk.slice(start);
              }
            }
            if (leftover && leftover.length > 0) {
              context.signal.throwIfAborted();
              const offset = leftover.length;
              let boundary = leftover.indexOf(sepByte, 0);
              let fStart = 0;
              let fEnd = offset;
              if (boundary >= 0) {
                let f = 1;
                while (f < targetField && boundary >= 0) {
                  fStart = boundary + 1;
                  boundary = fStart <= offset ? leftover.indexOf(sepByte, fStart) : -1;
                  f++;
                }
                if (f < targetField) {
                  fStart = offset;
                  fEnd = offset;
                } else {
                  fEnd = boundary < 0 ? offset : boundary;
                }
              }
              const pending = writeField(leftover, fStart, fEnd);
              if (pending) await pending;
            }
            const pending = flush();
            if (pending) await pending;
            return { exitCode: 0 };
          } catch (error) {
            await diagnostic(context, error);
            return { exitCode: 1 };
          } finally {
            if (ownsShared) sharedCutOutInUse = false;
          }
}
