import { PublicDiagnostic } from "../diagnostics.js";
import { FsError, type ByteSource, type CommandContext, type CommandDefinition } from "../contracts/index.js";
import { assertInputRequirements, bufferLimit, codeOf, concatenate, define, diagnostic, encoder, input, integer, lines, options, output, pathOf, requireOperands, UsageError, value } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { inputRequirements, textOutputRequirements } from "./portable-requirements.js";
import { yieldTurn } from "../contracts/yield.js";
import { RecordBuffer } from "./record-buffer.js";
import { SortRecordBudget } from "./sort-admission.js";
import { compareObservedEntries } from "./copy-identity.js";

class SortWork {
  #pending = 0;

  constructor(readonly signal: AbortSignal) {}

  charge(units = 1): Promise<void> | undefined {
    this.signal.throwIfAborted();
    this.#pending += units;
    if (this.#pending >= 4096) return this.#checkpoint();
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
  const ordered = await sortRecords(ranges, async (left, right) => left.start - right.start, work);
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

class CutOutput {
  readonly #buffer = new Uint8Array(64 * 1024);
  #used = 0;

  constructor(readonly context: CommandContext, readonly work: SortWork) {}

  write(bytes: Uint8Array): Promise<void> | undefined {
    if (bytes.length <= 4096 && this.#used + bytes.length < this.#buffer.length) {
      const checkpoint = this.work.charge(bytes.length);
      this.#buffer.set(bytes, this.#used);
      this.#used += bytes.length;
      return checkpoint;
    }
    return this.#writeSlow(bytes);
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

function compareSortBytes(left: Uint8Array, right: Uint8Array, work: SortWork): number | Promise<number> {
  const length = Math.min(left.length, right.length);
  if (length <= 1024) {
    const checkpoint = work.charge(2 * length);
    const order = Buffer.compare(left.subarray(0, length), right.subarray(0, length)) || (left.length - right.length);
    return checkpoint ? checkpoint.then(() => order) : order;
  }
  return (async () => {
    for (let offset = 0; offset < length; offset += 1024) {
      const end = Math.min(offset + 1024, length);
      const checkpoint = work.charge(2 * (end - offset));
      if (checkpoint) await checkpoint;
      const compared = Buffer.compare(left.subarray(offset, end), right.subarray(offset, end));
      if (compared) return compared;
    }
    return left.length - right.length;
  })();
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

function parseNumericSync(bytes: Uint8Array, human = false): NumericValue {
  const buf = Buffer.from(bytes);
  const len = bytes.length;
  let i = 0;
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
  const whole = wholeEnd > wholeStart ? buf.toString("latin1", wholeStart, wholeEnd) : "0";
  const fraction = fracEnd > fracStart ? buf.toString("latin1", fracStart, fracEnd) : "";
  const nonzero = whole !== "0" || fraction !== "";
  const suffix = bytes[i];
  const suffixRank = human && nonzero ? "KMGTPEZYRQ".indexOf(String.fromCharCode(suffix === 107 ? 75 : suffix ?? 0)) + 1 : 0;
  return { whole, fraction, negative: neg && nonzero, suffixRank };
}

function parseNumeric(bytes: Uint8Array, work: SortWork, human = false): NumericValue | Promise<NumericValue> {
  const checkpoint = work.charge(bytes.length);
  return checkpoint ? checkpoint.then(() => parseNumericSync(bytes, human)) : parseNumericSync(bytes, human);
}

function compareNumericValues(first: NumericValue, second: NumericValue, work: SortWork): number | Promise<number> {
  if (first.negative !== second.negative) return first.negative ? -1 : 1;
  let compared = first.suffixRank - second.suffixRank;
  if (!compared) compared = first.whole.length - second.whole.length;
  if (!compared && first.whole.length <= 1024 && Math.max(first.fraction.length, second.fraction.length) <= 1024) {
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
    return checkpoint ? checkpoint.then(() => result) : result;
  }
  return (async () => {
    if (!compared) {
      for (let offset = 0; offset < first.whole.length && !compared; offset += 1024) {
        const end = Math.min(offset + 1024, first.whole.length);
        const checkpoint = work.charge(2 * (end - offset));
        if (checkpoint) await checkpoint;
        const firstWhole = first.whole.slice(offset, end);
        const secondWhole = second.whole.slice(offset, end);
        compared = firstWhole < secondWhole ? -1 : firstWhole > secondWhole ? 1 : 0;
      }
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
  })();
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
  let end = bytes.length;
  let suffix = bytes.length;
  for (let index = bytes.length - 1; index >= 0; index--) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    const byte = bytes[index]!;
    if (byte === 46 && index + 1 < suffix) {
      const first = bytes[index + 1]!;
      if (first === 126 || first >= 65 && first <= 90 || first >= 97 && first <= 122) { end = index; suffix = index; continue; }
      break;
    }
    if (!(byte === 126 || byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122)) break;
  }
  return bytes.subarray(0, end);
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

function keyBytesSync(line: Uint8Array, key: SortKey, separator: number | undefined, blanks: boolean, work: SortWork): Uint8Array | Promise<Uint8Array> {
  if (line.length > 1024) return keyBytes(line, key, separator, blanks, work);
  const fields: { start: number; end: number }[] = [];
  if (separator !== undefined) {
    let start = 0;
    for (let offset = 0; offset <= line.length; offset++) {
      if (offset === line.length || line[offset] === separator) {
        fields.push({ start, end: offset }); start = offset + 1;
      }
    }
  } else {
    let offset = 0;
    while (offset < line.length) {
      const leading = offset;
      while (offset < line.length && (line[offset] === 32 || line[offset] === 9)) offset++;
      const start = leading;
      if (offset === line.length) break;
      while (offset < line.length && line[offset] !== 32 && line[offset] !== 9) offset++;
      fields.push({ start, end: offset });
    }
  }
  let extraCharge = line.length;
  const fieldStart = (field: { start: number; end: number } | undefined, skipBlanks: boolean) => {
    let offset = field?.start ?? line.length;
    if (skipBlanks) while (offset < (field?.end ?? line.length) && (line[offset] === 32 || line[offset] === 9)) {
      extraCharge++;
      offset++;
    }
    return offset;
  };
  const inheritBlanks = key.flags.size === 0 && blanks;
  const start = fieldStart(fields[key.start - 1], key.startBlanks || inheritBlanks) + key.startCharacter - 1;
  const last = key.end === undefined ? undefined : fields[key.end - 1];
  const end = key.end === undefined ? line.length : last === undefined ? line.length
    : key.endCharacter === undefined ? last.end : Math.min(line.length, fieldStart(last, key.endBlanks || inheritBlanks) + key.endCharacter);
  const result = line.subarray(Math.min(start, line.length), Math.max(start, end));
  const checkpoint = work.charge(extraCharge);
  return checkpoint ? checkpoint.then(() => result) : result;
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
      if (offset === line.length) break;
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
      while (start < chunk.length) {
        const offset = chunk.indexOf(delimiter, start);
        if (offset < 0) break;
        const accepted = accept(pending.finish(admit, chunk, start, offset));
        if ((accepted instanceof Promise ? await accepted : accepted) === false) return false;
        start = offset + 1;
      }
      pending.append(chunk, start);
    }
    if (pending.size) return await accept(pending.finish(admit)) !== false;
    return true;
  } finally { pending.clear(); }
}

export function textCommands(): CommandDefinition[] {
  return [
    define("sort", async context => {
      const parsed = options(context.args, "hngMVdimrfbuszt:k:o:cS:", { "human-numeric-sort": "h", "numeric-sort": "n", "general-numeric-sort": "g", "month-sort": "M", "version-sort": "V", "dictionary-order": "d", "ignore-nonprinting": "i", merge: "m", sort: "S", reverse: "r", "ignore-case": "f", "ignore-leading-blanks": "b", unique: "u", stable: "s", "zero-terminated": "z", "field-separator": "t", key: "k", output: "o", check: "c" }, false, undefined, (key, index) => {
        // S is only an internal value slot for --sort, not a buffer-size option.
        if (key === "S" && !context.args[index]!.startsWith("--sort=") && context.args[index - 1] !== "--sort") throw new UsageError("invalid option -- 'S'");
      });
      for (const mode of parsed.values.get("S") ?? []) {
        const flag = new Map([["numeric", "n"], ["general-numeric", "g"], ["human-numeric", "h"], ["month", "M"], ["version", "V"]]).get(mode);
        if (flag === undefined) throw new UsageError(`invalid sort argument '${mode}'`);
        parsed.flags.add(flag);
      }
      await assertInputRequirements(context, parsed.operands);
      if (!parsed.flags.has("c")) await admitTextOutput(context, value(parsed, "o"));
      const separatorText = value(parsed, "t");
      if (separatorText !== undefined && encoder.encode(separatorText).length !== 1) throw new UsageError("field separator must be one byte");
      const separator = separatorText === undefined ? undefined : encoder.encode(separatorText)[0];
      const keys = (parsed.values.get("k") ?? []).map(sortKey);
      for (const key of keys.length ? keys : [undefined]) {
        const flags = key?.flags.size ? key.flags : parsed.flags;
        const modes = ["h", "n", "g", "M", "V"].filter(flag => flags.has(flag));
        if (modes.length > 1) throw new UsageError(`options '-${modes.join("")}' are incompatible`);
      }
      const simple = !keys.length && !["b", "f", "h", "n", "g", "M", "V", "d", "i"].some(flag => parsed.flags.has(flag));
      const direction = parsed.flags.has("r") ? -1 : 1;
      const work = new SortWork(context.signal);
      let compareNumeric = async (left: Uint8Array, right: Uint8Array, human: boolean) => compareNumericValues(await parseNumeric(left, work, human), await parseNumeric(right, work, human), work);
      if (!keys.length && (parsed.flags.has("n") || parsed.flags.has("h")) && !["b", "f", "c", "d", "i"].some(flag => parsed.flags.has(flag))) {
        const numericValues = new Map<Uint8Array, NumericValue>();
        let retainedBytes = 0;
        const numericValue = async (bytes: Uint8Array): Promise<NumericValue> => {
          const cached = numericValues.get(bytes);
          if (cached !== undefined) return cached;
          context.signal.throwIfAborted();
          const charge = 6 * bytes.length + 10;
          if (numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes) return parseNumeric(bytes, work, parsed.flags.has("h"));
          const parsedValue = await parseNumeric(bytes, work, parsed.flags.has("h"));
          numericValues.set(bytes, parsedValue);
          retainedBytes += charge;
          return parsedValue;
        };
        compareNumeric = async (left, right) => compareNumericValues(await numericValue(left), await numericValue(right), work);
      }
      let keyCompare: (left: Uint8Array, right: Uint8Array) => number | Promise<number> = (left: Uint8Array, right: Uint8Array) => {
        const checkpoint = work.charge();
        if (simple) {
          if (checkpoint) return checkpoint.then(async () => (await compareSortBytes(left, right, work)) * direction);
          const cmp = compareSortBytes(left, right, work);
          return typeof cmp === "number" ? cmp * direction : cmp.then(result => result * direction);
        }
        return (async () => {
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
        })();
      };
      const numericKey = keys.length === 1 ? keys[0] : undefined;
      const numericKeyFlags = numericKey?.flags.size ? numericKey.flags : parsed.flags;
      if (numericKey && (numericKeyFlags.has("n") || numericKeyFlags.has("h")) && !["b", "f", "d", "i"].some(flag => numericKeyFlags.has(flag)) && !parsed.flags.has("c")) {
        const keyedNumericValues = new Map<Uint8Array, NumericValue>();
        let retainedKeyBytes = 0;
        const keyedNumericValue = (record: Uint8Array): NumericValue | Promise<NumericValue> => {
          const cached = keyedNumericValues.get(record);
          if (cached !== undefined) return cached;
          context.signal.throwIfAborted();
          const bytesOrPromise = keyBytesSync(record, numericKey, separator, false, work);
          if (!(bytesOrPromise instanceof Promise)) {
            const charge = 6 * bytesOrPromise.length + 10;
            const parsedOrPromise = parseNumeric(bytesOrPromise, work, numericKeyFlags.has("h"));
            if (!(parsedOrPromise instanceof Promise)) {
              if (keyedNumericValues.size < 16_384 && charge <= 1_048_576 - retainedKeyBytes) {
                keyedNumericValues.set(record, parsedOrPromise);
                retainedKeyBytes += charge;
              }
              return parsedOrPromise;
            }
            return parsedOrPromise.then(parsedValue => {
              if (keyedNumericValues.size < 16_384 && charge <= 1_048_576 - retainedKeyBytes) {
                keyedNumericValues.set(record, parsedValue);
                retainedKeyBytes += charge;
              }
              return parsedValue;
            });
          }
          return (async () => {
            const bytes = await bytesOrPromise;
            const charge = 6 * bytes.length + 10;
            if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes) return await parseNumeric(bytes, work, numericKeyFlags.has("h"));
            const parsedValue = await parseNumeric(bytes, work, numericKeyFlags.has("h"));
            keyedNumericValues.set(record, parsedValue);
            retainedKeyBytes += charge;
            return parsedValue;
          })();
        };
        keyCompare = async (left, right) => {
          const checkpoint = work.charge();
          if (checkpoint) await checkpoint;
          const leftPending = keyedNumericValue(left);
          const leftVal = leftPending instanceof Promise ? await leftPending : leftPending;
          const rightPending = keyedNumericValue(right);
          const rightVal = rightPending instanceof Promise ? await rightPending : rightPending;
          const comparison = compareNumericValues(leftVal, rightVal, work);
          const result = comparison instanceof Promise ? await comparison : comparison;
          return numericKeyFlags.has("r") ? -result : result;
        };
      }
      const compare = (left: Uint8Array, right: Uint8Array): number | Promise<number> => {
        const result = keyCompare(left, right);
        if (typeof result === "number") {
          if (result !== 0 || simple || parsed.flags.has("s") || parsed.flags.has("u")) return result;
          const fallback = compareSortBytes(left, right, work);
          return typeof fallback === "number" ? fallback * direction : fallback.then(r => r * direction);
        }
        return result.then(async resolved => {
          if (resolved !== 0 || simple || parsed.flags.has("s") || parsed.flags.has("u")) return resolved;
          return (await compareSortBytes(left, right, work)) * direction;
        });
      };
      const records: Uint8Array[] = [];
      const runs: Uint8Array[][] = [];
      const recordBudget = new SortRecordBudget();
      const exitCode: number = 0;
      const delimiter = parsed.flags.has("z") ? 0 : 10;
      for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
        const run: Uint8Array[] = [];
        if (parsed.flags.has("m")) runs.push(run);
        try {
          const complete = await collectSortRecords(input(context, name), delimiter, recordBudget, context.signal, bytes => {
            context.signal.throwIfAborted();
            if (!parsed.flags.has("c")) { (parsed.flags.has("m") ? run : records).push(bytes); return; }
            return (async () => {
              if (records.length && (await compare(records.at(-1)!, bytes) > 0 || parsed.flags.has("u") && await keyCompare(records.at(-1)!, bytes) === 0)) {
                await diagnostic(context, new PublicDiagnostic(`disorder at record ${records.length + 1}`));
                return false;
              }
              records.push(bytes);
            })();
          });
          if (!complete) return { exitCode: 1 };
        } catch (error) { await diagnostic(context, error); return { exitCode: 2 }; }
      }
      if (parsed.flags.has("c")) return { exitCode };
      const ordered = parsed.flags.has("m") ? await mergeSortRuns(runs, compare, work) : await sortRecords(records, compare, work);
      const sorted = (async function* (): ByteSource {
        let previous: Uint8Array | undefined;
        let buffer = new Uint8Array(64 * 1024);
        let used = 0;
        for (const record of ordered) {
          context.signal.throwIfAborted();
          if (parsed.flags.has("u") && previous !== undefined && await keyCompare(previous, record) === 0) continue;
          let offset = 0;
          while (offset < record.length) {
            const length = Math.min(record.length - offset, buffer.length - used);
            buffer.set(record.subarray(offset, offset + length), used);
            offset += length; used += length;
            if (used === buffer.length) { yield buffer; buffer = new Uint8Array(64 * 1024); used = 0; }
          }
          buffer[used++] = delimiter;
          if (used === buffer.length) { yield buffer; buffer = new Uint8Array(64 * 1024); used = 0; }
          previous = record;
        }
        if (used) yield buffer.subarray(0, used);
      })();
      await emitRecords(context, sorted, value(parsed, "o"));
      return { exitCode };
    }),
    define("uniq", async context => {
      // Optional long arguments are accepted only after '=', never as operands.
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
      const key = (bytes: Uint8Array) => {
        let offset = 0;
        for (let field = 0; field < skipFields; field++) {
          while (offset < bytes.length && (bytes[offset] === 32 || bytes[offset] === 9)) offset++;
          while (offset < bytes.length && bytes[offset] !== 32 && bytes[offset] !== 9) offset++;
        }
        offset += skipCharacters;
        const result = bytes.subarray(offset, width === Infinity ? undefined : offset + width);
        return parsed.flags.has("i") ? fold(result) : result;
      };
      const records = (async function* (): ByteSource {
        let previous: Uint8Array | undefined;
        let previousKey: Uint8Array | undefined;
        let count = 0;
        let emittedGroup = false;
        const expanded = allRepeated || groupMethod !== undefined;
        const method = groupMethod ?? repeatedMethod;
        const selected = () => (!parsed.flags.has("d") || count > 1) && (!parsed.flags.has("u") || count === 1);
        const record = () => concatenate([...(parsed.flags.has("c") ? [encoder.encode(`${String(count).padStart(7)} `)] : []), previous!, Uint8Array.of(delimiter)]);
        for await (const line of lines(input(context, parsed.operands[0]), delimiter)) {
          context.signal.throwIfAborted();
          const currentKey = key(line.bytes);
          if (previousKey && compareBytes(previousKey, currentKey) === 0) {
            count++;
            if (expanded && !parsed.flags.has("u")) {
              if (allRepeated && count === 2) {
                if (method === "prepend" || (method === "separate" && emittedGroup)) yield Uint8Array.of(delimiter);
                yield record();
                emittedGroup = true;
              }
              yield concatenate([line.bytes, Uint8Array.of(delimiter)]);
            }
          }
          else {
            if (!expanded && previous !== undefined && selected()) yield record();
            previous = line.bytes; previousKey = currentKey; count = 1;
            if (groupMethod !== undefined) {
              if (method === "prepend" || method === "both" || emittedGroup) yield Uint8Array.of(delimiter);
              yield record();
              emittedGroup = true;
            }
          }
        }
        if (!expanded && previous !== undefined && selected()) yield record();
        if (emittedGroup && (method === "append" || method === "both")) yield Uint8Array.of(delimiter);
      })();
      await emitRecords(context, records, parsed.operands[1]);
      return { exitCode: 0 };
    }),
    define("cut", async context => {
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
      if (delimiter.length !== (delimiter.codePointAt(0)! > 0xffff ? 2 : 1)) throw new UsageError("delimiter must be a single character");
      const outputDelimiter = value(parsed, "output-delimiter");
      const recordDelimiter = parsed.flags.has("z") ? 0 : 10;
      const recordDelimiterBytes = Uint8Array.of(recordDelimiter);
      const outputDelimiterBytes = encoder.encode(outputDelimiter ?? delimiter);
      const separator = Buffer.from(encoder.encode(delimiter));
      const writer = new CutOutput(context, work);
      let exitCode = 0;
      for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
        try {
          try {
            for await (const line of lines(input(context, name), recordDelimiter)) {
              context.signal.throwIfAborted();
              let cursor = 0;
              const selected = (position: number) => {
                while (cursor < ranges.length && position > ranges[cursor]!.end) cursor++;
                const included = cursor < ranges.length && position >= ranges[cursor]!.start;
                return included !== complement ? cursor : -1;
              };
              if (mode === "f") {
                const record = Buffer.from(line.bytes.buffer, line.bytes.byteOffset, line.bytes.byteLength);
                const b0 = cutFieldBoundary(record, separator, 0, work);
                let boundary = typeof b0 === "number" ? b0 : await b0;
                if (boundary < 0) {
                  if (parsed.flags.has("s")) continue;
                  const w = writer.write(line.bytes);
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
                for (let offset = 0; offset < line.bytes.length; offset += 4096) {
                  const end = Math.min(line.bytes.length, offset + 4096);
                  const checkpoint = work.charge(end - offset);
                  if (checkpoint) await checkpoint;
                  let start = -1;
                  for (let index = offset; index < end; index++) {
                    const range = selected(index + 1);
                    if (range !== previousRange && start >= 0) { await writer.write(line.bytes.subarray(start, index)); start = -1; }
                    if (range >= 0 && start < 0) {
                      if (range !== previousRange && emitted && outputDelimiter !== undefined) await writer.write(outputDelimiterBytes);
                      start = index;
                      emitted = true;
                    }
                    previousRange = range;
                  }
                  if (start >= 0) await writer.write(line.bytes.subarray(start, end));
                }
              } else {
                const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
                let index = 0;
                let emitted = false;
                let previousRange = -1;
                for (let offset = 0; offset < line.bytes.length; offset += 4096) {
                  const end = Math.min(line.bytes.length, offset + 4096);
                  const checkpoint = work.charge(end - offset);
                  if (checkpoint) await checkpoint;
                  const text = decoder.decode(line.bytes.subarray(offset, end), { stream: end < line.bytes.length });
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
              const wd = writer.write(recordDelimiterBytes);
              if (wd) await wd;
            }
          } finally {
            await writer.flush();
          }
        } catch (error) { await diagnostic(context, error); exitCode = 1; }
      }
      return { exitCode };
    }),
  ].map(command => ({ ...command, filesystemRequirements: command.name === "cut" ? inputRequirements : textOutputRequirements }));
}
