import { FsError, type ByteSource, type CommandContext, type CommandDefinition } from "../contracts/index.js";
import { assertInputRequirements, bufferLimit, concatenate, define, diagnostic, encoder, input, integer, lines, options, output, pathOf, requireOperands, UsageError, value } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { inputRequirements, textOutputRequirements } from "./portable-requirements.js";
import { yieldTurn } from "../contracts/yield.js";

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

async function sortRecords<Record>(records: Record[], compare: (left: Record, right: Record) => Promise<number>, work: SortWork): Promise<Record[]> {
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
        if (left < middle && (right === end || await compare(source[left]!, source[right]!) <= 0)) target[index] = source[left++]!;
        else target[index] = source[right++]!;
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
  for (let index = 0; index <= list.length; index++) {
    const checkpoint = work.charge();
    if (checkpoint) await checkpoint;
    const character = list[index];
    if (character === "," || character === " " || index === list.length) {
      if (index === tokenStart) {
        if (index === 0 || index === list.length) throw new UsageError("invalid range ''");
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
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else normalized.push(range);
  }
  return normalized;
}

class CutOutput {
  readonly #buffer = new Uint8Array(64 * 1024);
  #used = 0;

  constructor(readonly context: CommandContext, readonly work: SortWork) {}

  async write(bytes: Uint8Array): Promise<void> {
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

async function cutFieldBoundary(record: Buffer, separator: Uint8Array, start: number, work: SortWork): Promise<number> {
  for (let offset = start; offset < record.length; offset += 4096) {
    const window = record.subarray(offset, Math.min(record.length, offset + 4096 + separator.length - 1));
    const found = window.indexOf(separator);
    const checkpoint = work.charge(found < 0 ? Math.min(4096, window.length) : found + separator.length);
    if (checkpoint) await checkpoint;
    if (found >= 0) return offset + found;
  }
  return -1;
}

async function compareSortBytes(left: Uint8Array, right: Uint8Array, work: SortWork): Promise<number> {
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset += 1024) {
    const end = Math.min(offset + 1024, length);
    await work.charge(2 * (end - offset));
    const compared = Buffer.compare(left.subarray(offset, end), right.subarray(offset, end));
    if (compared) return compared;
  }
  return left.length - right.length;
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

interface NumericValue { whole: string; fraction: string; negative: boolean }

async function parseNumeric(bytes: Uint8Array, work: SortWork): Promise<NumericValue> {
  await work.charge(bytes.length);
  const match = /^[ \t]*(-?)([0-9]*)(?:\.([0-9]*))?/u.exec(Buffer.from(bytes).toString("latin1"))!;
  const whole = (match[2] ?? "").replace(/^0+/u, "") || "0";
  const fraction = (match[3] ?? "").replace(/0+$/u, "");
  return { whole, fraction, negative: match[1] === "-" && (whole !== "0" || fraction !== "") };
}

async function compareNumericValues(first: NumericValue, second: NumericValue, work: SortWork): Promise<number> {
  if (first.negative !== second.negative) return first.negative ? -1 : 1;
  let compared = first.whole.length - second.whole.length;
  if (!compared) {
    for (let offset = 0; offset < first.whole.length && !compared; offset += 1024) {
      const end = Math.min(offset + 1024, first.whole.length);
      await work.charge(2 * (end - offset));
      const firstWhole = first.whole.slice(offset, end);
      const secondWhole = second.whole.slice(offset, end);
      compared = firstWhole < secondWhole ? -1 : firstWhole > secondWhole ? 1 : 0;
    }
  }
  if (!compared) {
    const width = Math.max(first.fraction.length, second.fraction.length);
    for (let offset = 0; offset < width && !compared; offset += 1024) {
      const end = Math.min(offset + 1024, width);
      await work.charge(2 * (end - offset));
      const firstFraction = first.fraction.slice(offset, end).padEnd(end - offset, "0");
      const secondFraction = second.fraction.slice(offset, end).padEnd(end - offset, "0");
      compared = firstFraction < secondFraction ? -1 : firstFraction > secondFraction ? 1 : 0;
    }
  }
  return first.negative ? -compared : compared;
}

interface SortKey { start: number; startCharacter: number; end?: number; endCharacter?: number; flags: Set<string> }

function sortKey(specification: string): SortKey {
  const match = /^([0-9]+)(?:\.([0-9]+))?([bfnr]*)(?:,([0-9]+)(?:\.([0-9]+))?([bfnr]*))?$/u.exec(specification);
  if (!match) throw new UsageError(`invalid key '${specification}'`);
  return {
    start: integer(match[1]!, 1), startCharacter: integer(match[2] ?? "1", 1),
    ...(match[4] === undefined ? {} : { end: integer(match[4], 1) }),
    ...(match[5] === undefined ? {} : { endCharacter: integer(match[5], 1) }),
    flags: new Set((match[3] ?? "") + (match[6] ?? "")),
  };
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
      const start = blanks ? offset : leading;
      if (offset === line.length) break;
      while (offset < line.length && line[offset] !== 32 && line[offset] !== 9) {
        if (++offset % 1024 === 0) await work.charge(1024);
      }
      fields.push({ start, end: offset });
    }
  }
  await work.charge(line.length % 1024);
  const start = (fields[key.start - 1]?.start ?? line.length) + key.startCharacter - 1;
  const last = key.end === undefined ? undefined : fields[key.end - 1];
  const end = key.end === undefined ? line.length : last === undefined ? line.length
    : key.endCharacter === undefined ? last.end : Math.min(last.end, last.start + key.endCharacter);
  return line.subarray(Math.min(start, line.length), Math.max(start, end));
}

async function emitRecords(context: CommandContext, records: ByteSource, destination?: string): Promise<void> {
  if (destination === undefined) { for await (const bytes of records) await output(context, bytes); return; }
  await admitTextOutput(context, destination);
  if (context.fs.writeStream && context.fs.capabilities.streamingWrite !== false) await context.fs.writeStream(pathOf(context, destination), records, { signal: context.signal });
  else {
    if (context.fs.capabilities.write === false) throw new FsError("ENOTSUP", { syscall: "writeFile", path: pathOf(context, destination) });
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

async function collectSortRecords(source: ByteSource, delimiter: number, accept: (bytes: Uint8Array) => void): Promise<void> {
  let pending: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    let start = 0;
    for (let offset = 0; offset < chunk.length; offset++) {
      if (chunk[offset] !== delimiter) continue;
      const part = chunk.subarray(start, offset);
      size += part.length;
      if (size > bufferLimit) throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
      if (pending.length) { pending.push(part); accept(concatenate(pending, size)); }
      else accept(new Uint8Array(part));
      pending = []; size = 0; start = offset + 1;
    }
    if (start < chunk.length) {
      pending.push(new Uint8Array(chunk.subarray(start)));
      size += chunk.length - start;
      if (size > bufferLimit) throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
    }
  }
  if (size) accept(concatenate(pending, size));
}

export function textCommands(): CommandDefinition[] {
  return [
    define("sort", async context => {
      const parsed = options(context.args, "nrfbuszt:k:o:c", { "numeric-sort": "n", reverse: "r", "ignore-case": "f", "ignore-leading-blanks": "b", unique: "u", stable: "s", "zero-terminated": "z", "field-separator": "t", key: "k", output: "o", check: "c" });
      await assertInputRequirements(context, parsed.operands);
      if (!parsed.flags.has("c")) await admitTextOutput(context, value(parsed, "o"));
      const separatorText = value(parsed, "t");
      if (separatorText !== undefined && encoder.encode(separatorText).length !== 1) throw new UsageError("field separator must be one byte");
      const separator = separatorText === undefined ? undefined : encoder.encode(separatorText)[0];
      const keys = (parsed.values.get("k") ?? []).map(sortKey);
      const simple = !keys.length && !["b", "f", "n"].some(flag => parsed.flags.has(flag));
      const direction = parsed.flags.has("r") ? -1 : 1;
      const work = new SortWork(context.signal);
      let compareNumeric = async (left: Uint8Array, right: Uint8Array) => compareNumericValues(await parseNumeric(left, work), await parseNumeric(right, work), work);
      if (!keys.length && parsed.flags.has("n") && !["b", "f", "c"].some(flag => parsed.flags.has(flag))) {
        const numericValues = new Map<Uint8Array, NumericValue>();
        let retainedBytes = 0;
        const numericValue = async (bytes: Uint8Array): Promise<NumericValue> => {
          const cached = numericValues.get(bytes);
          if (cached !== undefined) return cached;
          context.signal.throwIfAborted();
          const charge = 6 * bytes.length + 2;
          if (numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes) return parseNumeric(bytes, work);
          const parsedValue = await parseNumeric(bytes, work);
          numericValues.set(bytes, parsedValue);
          retainedBytes += charge;
          return parsedValue;
        };
        compareNumeric = async (left, right) => compareNumericValues(await numericValue(left), await numericValue(right), work);
      }
      let keyCompare = async (left: Uint8Array, right: Uint8Array) => {
        const checkpoint = work.charge();
        if (checkpoint) await checkpoint;
        if (simple) return await compareSortBytes(left, right, work) * direction;
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
          let result = flags.has("n") ? await compareNumeric(first, second) : await compareSortBytes(first, second, work);
          if (flags.has("r")) result = -result;
          if (result) return result;
        }
        return 0;
      };
      const numericKey = keys.length === 1 ? keys[0] : undefined;
      const numericKeyFlags = numericKey?.flags.size ? numericKey.flags : parsed.flags;
      if (numericKey && numericKeyFlags.has("n") && !["b", "f"].some(flag => numericKeyFlags.has(flag)) && !parsed.flags.has("c")) {
        const keyedNumericValues = new Map<Uint8Array, NumericValue>();
        let retainedKeyBytes = 0;
        const keyedNumericValue = async (record: Uint8Array): Promise<NumericValue> => {
          const cached = keyedNumericValues.get(record);
          if (cached !== undefined) return cached;
          context.signal.throwIfAborted();
          const bytes = await keyBytes(record, numericKey, separator, false, work);
          const charge = 6 * bytes.length + 2;
          if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes) return parseNumeric(bytes, work);
          const parsedValue = await parseNumeric(bytes, work);
          keyedNumericValues.set(record, parsedValue);
          retainedKeyBytes += charge;
          return parsedValue;
        };
        keyCompare = async (left, right) => {
          const checkpoint = work.charge();
          if (checkpoint) await checkpoint;
          const result = await compareNumericValues(await keyedNumericValue(left), await keyedNumericValue(right), work);
          return numericKeyFlags.has("r") ? -result : result;
        };
      }
      const compare = async (left: Uint8Array, right: Uint8Array) => {
        const result = await keyCompare(left, right);
        return result || (simple || parsed.flags.has("s") || parsed.flags.has("u") ? 0 : await compareSortBytes(left, right, work) * direction);
      };
      const records: Uint8Array[] = [];
      let size = 0;
      const exitCode: number = 0;
      const delimiter = parsed.flags.has("z") ? 0 : 10;
      for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
        try {
          if (!parsed.flags.has("c")) {
            await collectSortRecords(input(context, name), delimiter, bytes => {
              context.signal.throwIfAborted();
              size += bytes.length + 1;
              if (size > bufferLimit) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
              records.push(bytes);
            });
            continue;
          }
          for await (const line of lines(input(context, name), delimiter)) {
            context.signal.throwIfAborted();
            size += line.bytes.length + 1;
            if (size > bufferLimit) throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
            if (parsed.flags.has("c") && records.length && (await compare(records.at(-1)!, line.bytes) > 0 || parsed.flags.has("u") && await keyCompare(records.at(-1)!, line.bytes) === 0)) {
              await diagnostic(context, new Error(`disorder at record ${records.length + 1}`));
              return { exitCode: 1 };
            }
            records.push(line.bytes);
          }
        } catch (error) { await diagnostic(context, error); return { exitCode: 2 }; }
      }
      if (parsed.flags.has("c")) return { exitCode };
      const ordered = await sortRecords(records, compare, work);
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
      const parsed = options(context.args, "cduif:s:w:z", { count: "c", repeated: "d", unique: "u", "ignore-case": "i", "skip-fields": "f", "skip-chars": "s", "check-chars": "w", "zero-terminated": "z" });
      requireOperands(parsed.operands, 0, 2);
      await assertInputRequirements(context, parsed.operands.slice(0, 1));
      await admitTextOutput(context, parsed.operands[1]);
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
        const selected = () => (!parsed.flags.has("d") || count > 1) && (!parsed.flags.has("u") || count === 1);
        const record = () => concatenate([...(parsed.flags.has("c") ? [encoder.encode(`${String(count).padStart(7)} `)] : []), previous!, Uint8Array.of(delimiter)]);
        for await (const line of lines(input(context, parsed.operands[0]), delimiter)) {
          context.signal.throwIfAborted();
          const currentKey = key(line.bytes);
          if (previousKey && compareBytes(previousKey, currentKey) === 0) count++;
          else {
            if (previous !== undefined && selected()) yield record();
            previous = line.bytes; previousKey = currentKey; count = 1;
          }
        }
        if (previous !== undefined && selected()) yield record();
      })();
      if (parsed.operands[1] !== undefined && parsed.operands[0] !== "-"
        && pathOf(context, parsed.operands[0]!) === pathOf(context, parsed.operands[1])) throw new UsageError("input and output must be different files");
      await emitRecords(context, records, parsed.operands[1]);
      return { exitCode: 0 };
    }),
    define("cut", async context => {
      const parsed = options(context.args, "b:c:f:d:szo:C", { bytes: "b", characters: "c", fields: "f", delimiter: "d", "only-delimited": "s", "zero-terminated": "z", "output-delimiter": "o", complement: "C" });
      await assertInputRequirements(context, parsed.operands);
      const modes = ["b", "c", "f"].filter(mode => parsed.flags.has(mode));
      if (modes.length !== 1) throw new UsageError("exactly one byte, character, or field list is required");
      const mode = modes[0]!;
      if (mode !== "f" && (parsed.flags.has("d") || parsed.flags.has("s"))) throw new UsageError("delimiter options require field mode");
      const work = new SortWork(context.signal);
      const ranges = await cutRanges(value(parsed, mode)!, work);
      const complement = parsed.flags.has("C");
      const delimiter = value(parsed, "d") ?? "\t";
      if (delimiter.length !== (delimiter.codePointAt(0)! > 0xffff ? 2 : 1)) throw new UsageError("delimiter must be a single character");
      const outputDelimiter = value(parsed, "o");
      const recordDelimiter = parsed.flags.has("z") ? 0 : 10;
      const separator = Buffer.from(delimiter);
      const writer = new CutOutput(context, work);
      let exitCode = 0;
      for (const name of parsed.operands.length ? parsed.operands : ["-"]) {
        try {
          for await (const line of lines(input(context, name), recordDelimiter)) {
            context.signal.throwIfAborted();
            let cursor = 0;
            const selected = (position: number) => {
              while (cursor < ranges.length && position > ranges[cursor]!.end) cursor++;
              return (cursor < ranges.length && position >= ranges[cursor]!.start) !== complement;
            };
            if (mode === "f") {
              const record = Buffer.from(line.bytes.buffer, line.bytes.byteOffset, line.bytes.byteLength);
              let boundary = await cutFieldBoundary(record, separator, 0, work);
              if (boundary < 0) {
                if (parsed.flags.has("s")) continue;
                await writer.write(line.bytes);
              } else {
                let field = 1;
                let start = 0;
                let emitted = false;
                while (true) {
                  const checkpoint = work.charge();
                  if (checkpoint) await checkpoint;
                  if (selected(field++)) {
                    if (emitted) await writer.text(outputDelimiter ?? delimiter);
                    await writer.write(record.subarray(start, boundary < 0 ? record.length : boundary));
                    emitted = true;
                  }
                  if (boundary < 0) break;
                  start = boundary + separator.length;
                  boundary = await cutFieldBoundary(record, separator, start, work);
                }
              }
            } else if (mode === "b") {
              let emitted = false;
              let previousIncluded = false;
              for (let offset = 0; offset < line.bytes.length; offset += 4096) {
                const end = Math.min(line.bytes.length, offset + 4096);
                const checkpoint = work.charge(end - offset);
                if (checkpoint) await checkpoint;
                let start = -1;
                for (let index = offset; index < end; index++) {
                  const included = selected(index + 1);
                  if (included && start < 0) {
                    if (!previousIncluded && emitted && outputDelimiter !== undefined) await writer.text(outputDelimiter);
                    start = index;
                    emitted = true;
                  }
                  if (!included && start >= 0) { await writer.write(line.bytes.subarray(start, index)); start = -1; }
                  previousIncluded = included;
                }
                if (start >= 0) await writer.write(line.bytes.subarray(start, end));
              }
            } else {
              const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
              let index = 0;
              let emitted = false;
              let previousIncluded = false;
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
                  const included = selected(++index);
                  if (included && start < 0) {
                    if (!previousIncluded && emitted && outputDelimiter !== undefined) await writer.text(outputDelimiter);
                    start = position;
                    emitted = true;
                  }
                  if (!included && start >= 0) { await writer.text(text.slice(start, position)); start = -1; }
                  position += character.length;
                  previousIncluded = included;
                }
                if (start >= 0) await writer.text(text.slice(start));
              }
            }
            await writer.write(Uint8Array.of(recordDelimiter));
            await writer.flush();
          }
        } catch (error) { await diagnostic(context, error); exitCode = 1; }
      }
      return { exitCode };
    }),
  ].map(command => ({ ...command, filesystemRequirements: command.name === "cut" ? inputRequirements : textOutputRequirements }));
}
