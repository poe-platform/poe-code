import "../shell/sync-extra-evaluators.js";
import { compareByteArrays, decodeBytes, encodeBytes, indexOfBytes } from "../byte-encoding.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { createBufferedOutput, FsError, type ByteSource, type CommandContext, type CommandDefinition } from "../contracts/index.js";
import { RETURN_EXIT_ONE, RETURN_EXIT_ZERO, assertInputRequirements, bufferLimit, codeOf, concatenate, define, diagnostic, encoder, input, integer, options, output, outputRange, pathOf, requireOperands, RESOLVED_EXIT_ZERO, UsageError, value } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { inputRequirements, textOutputRequirements } from "./portable-requirements.js";
import { hasYieldCheckpoint, runYieldCheckpoint } from "../contracts/yield.js";
import { RecordBuffer } from "./record-buffer.js";
import { createSortCommand } from "./sort/index.js";
import { SortWork, sortRecords } from "safe-bash-command-sort/work";
import { compareObservedEntries } from "./copy-identity.js";
import { openFileOutput, writeFileOutput } from "../contracts/filesystem-output.js";

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
      if (end < start) throw new PublicDiagnostic(`invalid decreasing range '${list.slice(tokenStart, index)}'`);
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


function writeUniqCountBytes(writeByte: (b: number) => void, count: number): void {
  const digits = String(count);
  const pad = 7 - digits.length;
  for (let i = 0; i < pad; i++) writeByte(32);
  for (let i = 0; i < digits.length; i++) writeByte(digits.charCodeAt(i));
  writeByte(32);
}

class CutOutput {
  readonly #buffer: Uint8Array;
  #used = 0;

  constructor(readonly context: CommandContext, readonly work: SortWork) {
    this.#buffer = new Uint8Array(64 * 1024);
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

}

function cutFieldBoundary(record: Uint8Array, separator: Uint8Array, start: number, work: SortWork): number | Promise<number> {
  if (record.length - start <= 4096) {
    const found = separator.length === 1
      ? record.indexOf(separator[0]!, start)
      : indexOfBytes(record, separator, start);
    const charged = found < 0 ? record.length - start : found - start + separator.length;
    const checkpoint = work.charge(charged);
    return checkpoint ? checkpoint.then(() => found) : found;
  }
  return cutFieldBoundarySlow(record, separator, start, work);
}

async function cutFieldBoundarySlow(record: Uint8Array, separator: Uint8Array, start: number, work: SortWork): Promise<number> {
  for (let offset = start; offset < record.length; offset += 4096) {
    const window = record.subarray(offset, Math.min(record.length, offset + 4096 + separator.length - 1));
    const found = indexOfBytes(window, separator);
    const checkpoint = work.charge(found < 0 ? Math.min(4096, window.length) : found + separator.length);
    if (checkpoint) await checkpoint;
    if (found >= 0) return offset + found;
  }
  return -1;
}

const EMPTY_OPERANDS: readonly string[] = Object.freeze([]);

async function admitTextOutput(context: CommandContext, destination: string | undefined): Promise<void> {
  if (destination === undefined) return;
  assertCommandRequirements(context, textOutputRequirements, ["output"]);
  if (context.fs.capabilitiesFor) assertCommandRequirements(context, textOutputRequirements, ["output"],
    await context.fs.capabilitiesFor(pathOf(context, destination), { signal: context.signal }));
}

function fold(bytes: Uint8Array): Uint8Array { return bytes.map(byte => byte >= 97 && byte <= 122 ? byte - 32 : byte); }

async function emitRecords(context: CommandContext, records: ByteSource, destination?: string): Promise<void> {
  if (destination === undefined) {
    const buffered = createBufferedOutput(context.stdout, context.signal);
    try {
      for await (const bytes of records) {
        await buffered.write(bytes);
        await buffered.flush();
      }
    }
    finally { if (!context.signal.aborted) await buffered.flush(); }
    return;
  }
  void context.registerCleanup;
  await admitTextOutput(context, destination);
  const capabilities = await context.fs.capabilitiesFor?.(pathOf(context, destination), { signal: context.signal }) ?? context.fs.capabilities;
  if (context.fs.writeStream && capabilities.streamingWrite !== false) {
    const destinationOutput = await openFileOutput(context, pathOf(context, destination), "w");
    try {
      for await (const bytes of records) await destinationOutput.sink.write(bytes);
      await destinationOutput.finish();
    } catch (error) {
      await destinationOutput.abort(error);
      throw error;
    }
  }
  else {
    if (capabilities.write === false) throw new FsError("ENOTSUP", { syscall: "writeFile", path: pathOf(context, destination) });
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const bytes of records) {
      await writeFileOutput(context, bytes, async chunk => {
        size += chunk.length;
        chunks.push(new Uint8Array(chunk));
      });
    }
    await context.fs.writeFile(pathOf(context, destination), concatenate(chunks, size), { signal: context.signal });
  }
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
      const separator = delimiter.length === 0 ? Uint8Array.of(0) : encodeBytes(encoder.encode(delimiter));
      const outputDelimiterBytes = outputDelimiter === undefined ? separator : outputDelimiter.length === 0 ? Uint8Array.of(0) : encoder.encode(outputDelimiter);
      const writer = new CutOutput(context, work);
      let exitCode = 0;
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
            const sharedUtf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });
            const canFastSliceCut = (byteSelection || mode === "c") && !complement && ranges.length <= 16;
            const processFastSliceRange = (buf: Uint8Array, lineStart: number, lineEnd: number): Promise<void> | undefined | null => {
              const lineLen = lineEnd - lineStart;
              if (writer.remaining <= lineLen + (outputDelimiter !== undefined ? Math.max(0, ranges.length - 1) * outDelimLen : 0) + 1) {
                return null;
              }
              if (!byteSelection) {
                for (let i = lineStart; i < lineEnd; i++) {
                  if (buf[i]! >= 0x80) return null;
                }
              }
              context.signal.throwIfAborted();
              let totalCharge = lineLen + 1;
              let emitted = false;
              for (let rIdx = 0; rIdx < ranges.length; rIdx++) {
                const r = ranges[rIdx]!;
                const s = lineStart + r.start - 1;
                if (s >= lineEnd) break;
                const e = Math.min(lineEnd, lineStart + r.end);
                if (e > s) {
                  if (emitted && outputDelimiter !== undefined) {
                    totalCharge += writer.writeRangeUncharged(outputDelimiterBytes, 0, outDelimLen);
                  }
                  totalCharge += writer.writeRangeUncharged(buf, s, e);
                  emitted = true;
                }
              }
              writer.writeByteUncharged(recordDelimiter);
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
                const record = encodeBytes(lineBytes.buffer, lineBytes.byteOffset, lineBytes.byteLength);
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
                const decoder = sharedUtf8Decoder;
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
                  } else if (canFastSliceCut && pending.size === 0 && offset - start <= 4096) {
                    const p = processFastSliceRange(chunk, start, offset);
                    if (p === null) {
                      await processLineBytes(chunk.subarray(start, offset));
                    } else if (p) {
                      await p;
                    }
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
  const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG;
  const byteLocale = locale === "C" || locale === "POSIX";
  const uniqDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const key = (bytes: Uint8Array) => {
    if (identityKey) return bytes;
    let offset = 0;
    for (let field = 0; field < skipFields; field++) {
      while (offset < bytes.length && (bytes[offset] === 32 || bytes[offset] === 9)) offset++;
      while (offset < bytes.length && bytes[offset] !== 32 && bytes[offset] !== 9) offset++;
    }
    let result: Uint8Array;
    try {
      if (byteLocale) {
        offset += skipCharacters;
        result = bytes.subarray(offset, width === Infinity ? undefined : offset + width);
      } else {
        const chars = Array.from(uniqDecoder.decode(bytes.subarray(offset)));
        result = encoder.encode((width === Infinity ? chars.slice(skipCharacters) : chars.slice(skipCharacters, skipCharacters + width)).join(""));
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Invalid UTF-8 records retain byte comparisons without replacement characters.
      offset += skipCharacters;
      result = bytes.subarray(offset, width === Infinity ? undefined : offset + width);
    }
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
      if (previousKey && compareByteArrays(previousKey, currentKey) === 0) {
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
          previous = new Uint8Array(previous);
          if (previousKey?.buffer === chunk.buffer) previousKey = key(previous);
        }
        pending.append(chunk, start);
        if (outUsed > 0) {
          yield outBuf.slice(0, outUsed);
          outUsed = 0;
        }
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
  try {
    await emitRecords(context, records, parsed.operands[1]);
  } catch (error) {
    context.signal.throwIfAborted();
    const consumer = parsed.operands[1] === undefined ? context.stdout.ownedOutput?.consumerClosed : undefined;
    if (consumer?.aborted && consumer.reason === error && error instanceof FsError && error.code === "EPIPE") return { exitCode: 141 };
    throw error;
  }
  return { exitCode: 0 };
}

export function textCommands(): CommandDefinition[] {
  return [
    createSortCommand(),
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
              return diagnostic(context, error).then(RETURN_EXIT_ONE);
            }
            if (res1 !== undefined) {
              if (res1.done) return RESOLVED_EXIT_ZERO;
              const chunk = res1.value;
              let res2: IteratorResult<Uint8Array> | undefined;
              try {
                res2 = srcIter.tryNextSync();
              } catch (error) {
                return diagnostic(context, error).then(RETURN_EXIT_ONE);
              }
              if (res2 !== undefined && res2.done && chunk.length <= 65536) {
                const outBuf = new Uint8Array(128 * 1024);
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
                  const p = outputRange(context, outBuf, outUsed);
                  if (isSyncResolved(p)) return RESOLVED_EXIT_ZERO;
                  return p.then(RETURN_EXIT_ZERO);
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
          return executeUniqGeneral(context, { [Symbol.asyncIterator]: () => srcIter });
        }
      }
      return executeUniqGeneral(context);
    }),
    define("cut", context => {
      runYieldCheckpoint(context.signal);
      if (!hasYieldCheckpoint(context.signal)) {
        const args = context.args;
        let sepByte = 9;
        let targetField = 0;
        let fieldMask = 0;
        let operand: string | undefined;
        let canFast = args.length >= 1 && args.length <= 5;
        if (canFast) {
          for (let i = 0; i < args.length; i++) {
            const a = args[i]!;
            if (a.length >= 2 && a.charCodeAt(0) === 45) {
              const opt = a.charCodeAt(1);
              if (opt === 100) {
                if (a.length > 2) {
                  if (a.length !== 3 || a.charCodeAt(2) >= 128) {
                    canFast = false;
                    break;
                  }
                  sepByte = a.charCodeAt(2);
                } else {
                  const val = args[++i];
                  if (val === undefined || val.length !== 1 || val.charCodeAt(0) >= 128) {
                    canFast = false;
                    break;
                  }
                  sepByte = val.charCodeAt(0);
                }
              } else if (opt === 102) {
                const inline = a.length > 2;
                const val = inline ? a : args[++i];
                const startJ = inline ? 2 : 0;
                if (!val || val.length <= startJ || targetField > 0 || fieldMask !== 0) {
                  canFast = false;
                  break;
                }
                let num = 0;
                for (let j = startJ; j < val.length; j++) {
                  const c = val.charCodeAt(j) - 48;
                  if (c < 0 || c > 9 || num > 100000) {
                    num = 0;
                    break;
                  }
                  num = num * 10 + c;
                }
                if (num >= 1) {
                  targetField = num;
                } else {
                  const spec = val.slice(startJ);
                  if (/^[1-9][0-9]*(?:[,-][1-9][0-9]*)+$/.test(spec)) {
                    let mask = 0;
                    let okMask = true;
                    const parts = spec.split(",");
                    for (let p = 0; p < parts.length; p++) {
                      const part = parts[p]!;
                      const dashIdx = part.indexOf("-");
                      if (dashIdx === -1) {
                        const fn = Number(part);
                        if (fn < 1 || fn > 30) { okMask = false; break; }
                        mask |= (1 << fn);
                      } else {
                        const f1 = Number(part.slice(0, dashIdx));
                        const f2 = Number(part.slice(dashIdx + 1));
                        if (!Number.isFinite(f2) || f1 < 1 || f2 < f1 || f2 > 30) { okMask = false; break; }
                        for (let fn = f1; fn <= f2; fn++) mask |= (1 << fn);
                      }
                    }
                    if (okMask && mask !== 0) fieldMask = mask;
                    else { canFast = false; break; }
                  } else {
                    canFast = false;
                    break;
                  }
                }
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
        if (canFast && (targetField >= 1 || (fieldMask !== 0 && typeof (context.stdin as { tryReadAllSync?: unknown }).tryReadAllSync === "function"))) {
          const req = assertInputRequirements(context, operand !== undefined ? [operand] : EMPTY_OPERANDS);
          // Process each single-field chunk before requesting the next one so read
          // failures cannot discard completed records or bypass iterator cleanup.
          if (targetField >= 1) {
            return executeCutFastAsync(context, operand, sepByte, targetField, req, undefined, undefined, undefined);
          }
          if (!req && operand === undefined) {
            const srcIter = input(context, "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
              tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
            };
            if (typeof srcIter.tryNextSync === "function") {
              let res1: IteratorResult<Uint8Array> | undefined;
              try {
                res1 = srcIter.tryNextSync();
              } catch (error) {
                return diagnostic(context, error).then(RETURN_EXIT_ONE);
              }
              if (res1 !== undefined) {
                if (res1.done) return RESOLVED_EXIT_ZERO;
                const chunk = res1.value;
                let res2: IteratorResult<Uint8Array> | undefined;
                try {
                  res2 = srcIter.tryNextSync();
                } catch (error) {
                  return diagnostic(context, error).then(RETURN_EXIT_ONE);
                }
                if (res2 !== undefined && res2.done && chunk.length < 65536) {
                  const outBuf = new Uint8Array(65536);
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
                    if (fieldMask !== 0 && boundary >= 0) {
                      let f = 1;
                      let curStart = start;
                      let curBound = boundary;
                      let wroteField = false;
                      while (true) {
                        const curEnd = curBound >= 0 ? curBound : offset;
                        if ((fieldMask & (1 << f)) !== 0) {
                          if (wroteField) outBuf[outUsed++] = sepByte;
                          for (let index = curStart; index < curEnd; index++) outBuf[outUsed++] = chunk[index]!;
                          wroteField = true;
                        }
                        if (curBound < 0 || (fieldMask >>> (f + 1)) === 0) break;
                        curStart = curBound + 1;
                        curBound = curStart <= offset ? chunk.indexOf(sepByte, curStart) : -1;
                        if (curBound >= offset) curBound = -1;
                        f++;
                      }
                      outBuf[outUsed++] = 10;
                    } else {
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
                    }
                    start = offset + 1;
                  }
                  if (outUsed === 0) return RESOLVED_EXIT_ZERO;
                  const p = outputRange(context, outBuf, outUsed);
                  if (isSyncResolved(p)) return RESOLVED_EXIT_ZERO;
                  return p.then(RETURN_EXIT_ZERO);
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
          const outBuf = new Uint8Array(65536);
          let outUsed = 0;
          const flush = (): Promise<void> | undefined => {
            if (outUsed === 0) return;
            const length = outUsed;
            outUsed = 0;
            const p = outputRange(context, outBuf, length);
            context.signal.throwIfAborted();
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
          let done = false;
          let srcIter: (AsyncIterator<Uint8Array> & { tryNextSync?: () => IteratorResult<Uint8Array> | undefined; syncReturn?: () => void }) | undefined;
          try {
            srcIter = existingIter ?? (input(context, operand ?? "-")[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
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
              if (res.done) { done = true; break; }
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
            const pending = flush();
            if (pending) await pending;
            await diagnostic(context, error);
            return { exitCode: 1 };
          } finally {
            if (!done && srcIter) {
              if (typeof srcIter.syncReturn === "function") srcIter.syncReturn();
              else await srcIter.return?.();
            }
          }
}
