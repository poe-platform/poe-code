import { publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { hasYieldCheckpoint, monotonicNow, runYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
import { reusableBatchRows, trustedInputRows } from "../regex-execution/protocol.js";
import { readBytes, writeBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { SearchError, type SearchOptions } from "./options.js";
import { assertPathRequirements, searchRequirements } from "./requirements.js";

export function pathFor(context: CommandContext, path: string): string {
  if (!path || path.includes("\0")) throw new SearchError("invalid empty or NUL-containing path");
  return path.startsWith("/") ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

export class OutputClosed extends SearchError {}

const emptyBuffer = Buffer.alloc(0);
const OUT_BUFFER_SIZE = 64 * 1024;
const sharedOutBuf = new Uint8Array(OUT_BUFFER_SIZE);
let sharedOutBufInUse = false;

export class Limits {
  readonly maxOutputBytes: number;
  readonly maxLineBytes: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxPatternBytes: number;
  outputBytes = 0;
  files = 0;
  private ticks = 0;
  private readonly hasExtYield: boolean;
  private lastYieldMs = monotonicNow();
  private stopped: AbortController | undefined;
  private _signal: AbortSignal | undefined;
  private outBuf: Uint8Array | null = null;
  private usingSharedBuf = false;
  outPos = 0;
  constructor(readonly context: CommandContext, options: SearchOptions) {
    this.hasExtYield = hasYieldCheckpoint(context.signal);
    this.maxOutputBytes = options.maxOutputBytes ?? Infinity;
    this.maxLineBytes = options.maxLineBytes ?? Infinity;
    this.maxFileBytes = options.maxFileBytes ?? Infinity;
    this.maxFiles = options.maxFiles ?? Infinity;
    this.maxPatternBytes = options.maxPatternBytes ?? Infinity;
    if (
      (this.maxOutputBytes !== Infinity && !Number.isSafeInteger(this.maxOutputBytes)) || this.maxOutputBytes < 1 ||
      (this.maxLineBytes !== Infinity && !Number.isSafeInteger(this.maxLineBytes)) || this.maxLineBytes < 1 ||
      (this.maxFileBytes !== Infinity && !Number.isSafeInteger(this.maxFileBytes)) || this.maxFileBytes < 1 ||
      (this.maxFiles !== Infinity && !Number.isSafeInteger(this.maxFiles)) || this.maxFiles < 1 ||
      (this.maxPatternBytes !== Infinity && !Number.isSafeInteger(this.maxPatternBytes)) || this.maxPatternBytes < 1
    ) {
      throw new SearchError("search limits must be positive safe integers");
    }
  }
  get signal(): AbortSignal {
    if (!this._signal) {
      this.stopped ??= new AbortController();
      this._signal = AbortSignal.any([this.context.signal, this.stopped.signal]);
    }
    return this._signal;
  }
  private ensureOutBuf(): Uint8Array {
    let buf = this.outBuf;
    if (!buf) {
      if (!sharedOutBufInUse) {
        sharedOutBufInUse = true;
        this.usingSharedBuf = true;
        buf = this.outBuf = sharedOutBuf;
      } else {
        buf = this.outBuf = new Uint8Array(OUT_BUFFER_SIZE);
      }
    }
    return buf;
  }
  private releaseOutBuf(): void {
    if (this.usingSharedBuf) {
      this.usingSharedBuf = false;
      sharedOutBufInUse = false;
      this.outBuf = null;
    }
  }
  tick(): Promise<void> | undefined {
    if (this.context.signal.aborted) throw this.context.signal.reason;
    if (this.hasExtYield) {
      runYieldCheckpoint(this.context.signal);
      if ((++this.ticks & 127) === 0) return yieldTurn(this.context.signal);
      return undefined;
    }
    if ((++this.ticks & 2047) === 0) {
      const now = monotonicNow();
      if (now - this.lastYieldMs >= 25) {
        this.lastYieldMs = now;
        return yieldTurn(this.context.signal);
      }
    }
    return undefined;
  }
  private async write(chunk: Uint8Array): Promise<void> {
    try { await writeBytes(this.context.stdout, chunk, this._signal ?? this.context.signal); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if ((error as { code?: string }).code === "EPIPE") {
        const closed = new OutputClosed("stdout closed");
        this.stopped?.abort(closed);
        throw closed;
      }
      throw error;
    }
  }
  async flush(): Promise<void> {
    if (this.outPos > 0 && this.outBuf) {
      const slice = this.usingSharedBuf
        ? this.outBuf.slice(0, this.outPos)
        : this.outBuf.subarray(0, this.outPos);
      this.outPos = 0;
      try {
        await this.write(slice);
      } finally {
        this.releaseOutBuf();
      }
    } else {
      this.releaseOutBuf();
    }
  }
  outputSyncOrAsync(value: string | Uint8Array): Promise<void> | undefined {
    if (typeof value === "string") {
      const len = value.length;
      let ascii = true;
      for (let i = 0; i < len; i++) {
        if (value.charCodeAt(i) >= 0x80) { ascii = false; break; }
      }
      if (ascii && len <= OUT_BUFFER_SIZE) {
        if (this.outputBytes + len > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
        const buf = this.ensureOutBuf();
        if (this.outPos + len <= OUT_BUFFER_SIZE) {
          const pos = this.outPos;
          for (let i = 0; i < len; i++) {
            buf[pos + i] = value.charCodeAt(i);
          }
          this.outPos = pos + len;
          this.outputBytes += len;
          return undefined;
        }
      }
    }
    return this.output(value);
  }
  outputFilenameSyncOrAsync(label: string, nullPath: boolean): Promise<void> | undefined {
    const labelLen = label.length;
    const totalLen = labelLen + 1;
    if (totalLen <= OUT_BUFFER_SIZE) {
      const buf = this.ensureOutBuf();
      const pos = this.outPos;
      if (pos + totalLen <= OUT_BUFFER_SIZE) {
        let ascii = true;
        for (let i = 0; i < labelLen; i++) {
          const c = label.charCodeAt(i);
          if (c >= 0x80) { ascii = false; break; }
          buf[pos + i] = c;
        }
        if (ascii) {
          if (this.outputBytes + totalLen > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
          buf[pos + labelLen] = nullPath ? 0 : 10;
          this.outPos = pos + totalLen;
          this.outputBytes += totalLen;
          return undefined;
        }
      }
    }
    return this.output(label + (nullPath ? "\0" : "\n"));
  }
  outputCountSyncOrAsync(label: string, amount: number, filename: boolean, nullPath: boolean): Promise<void> | undefined {
    if (amount >= 0 && amount < 1000000000) {
      const labelLen = filename ? label.length : 0;
      let digits = 1;
      if (amount >= 10) {
        if (amount < 100) digits = 2;
        else if (amount < 1000) digits = 3;
        else if (amount < 10000) digits = 4;
        else if (amount < 100000) digits = 5;
        else if (amount < 1000000) digits = 6;
        else if (amount < 10000000) digits = 7;
        else if (amount < 100000000) digits = 8;
        else digits = 9;
      }
      const totalLen = (filename ? labelLen + 1 : 0) + digits + 1;
      if (totalLen <= OUT_BUFFER_SIZE) {
        const buf = this.ensureOutBuf();
        const pos = this.outPos;
        if (pos + totalLen <= OUT_BUFFER_SIZE) {
          let ascii = true;
          let dst = pos;
          if (filename) {
            for (let i = 0; i < labelLen; i++) {
              const c = label.charCodeAt(i);
              if (c >= 0x80) { ascii = false; break; }
              buf[dst + i] = c;
            }
            dst += labelLen;
            buf[dst++] = nullPath ? 0 : 58;
          }
          if (ascii) {
            if (this.outputBytes + totalLen > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
            let v = amount | 0;
            const dEnd = dst + digits;
            buf[dEnd] = 10;
            for (let d = dEnd - 1; d >= dst; d--) {
              const q = (v / 10) | 0;
              buf[d] = 48 + (v - q * 10);
              v = q;
            }
            this.outPos = pos + totalLen;
            this.outputBytes += totalLen;
            return undefined;
          }
        }
      }
    }
    return this.output(`${filename ? label + (nullPath ? "\0" : ":") : ""}${amount}\n`);
  }
  async output(value: string | Uint8Array): Promise<void> {
    if (typeof value === "string") {
      const len = value.length;
      let ascii = true;
      for (let i = 0; i < len; i++) {
        if (value.charCodeAt(i) >= 0x80) { ascii = false; break; }
      }
      if (ascii && len <= OUT_BUFFER_SIZE) {
        if (this.outputBytes + len > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
        if (this.outPos + len > OUT_BUFFER_SIZE) {
          await this.flush();
        }
        const buf = this.ensureOutBuf();
        const pos = this.outPos;
        for (let i = 0; i < len; i++) {
          buf[pos + i] = value.charCodeAt(i);
        }
        this.outPos = pos + len;
        this.outputBytes += len;
        return;
      }
    }
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    if (this.outputBytes + chunk.byteLength > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
    if (chunk.byteLength >= OUT_BUFFER_SIZE) {
      await this.flush();
      await this.write(chunk);
      this.outputBytes += chunk.byteLength;
      return;
    }
    if (this.outPos + chunk.byteLength > OUT_BUFFER_SIZE) {
      await this.flush();
    }
    const buf = this.ensureOutBuf();
    buf.set(chunk, this.outPos);
    this.outPos += chunk.byteLength;
    this.outputBytes += chunk.byteLength;
  }
}

export async function* fileInput(context: CommandContext, path: string, limits: Limits): ByteSource {
  await assertPathRequirements(context, searchRequirements, ["file"], [path]);
  if (context.fs.readStream) yield* readBytes(context.fs.readStream(path, { signal: context.signal }), limits.signal);
  else yield await context.fs.readFile(path, { signal: context.signal, ...(Number.isFinite(limits.maxFileBytes) ? { maxBytes: limits.maxFileBytes } : {}) });
}

export async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  await writeDiagnostic(context.stderr, `rg: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
}

export interface Line {
  readonly bytes: Uint8Array;
  readonly content: Buffer;
  readonly rawBytes: Buffer;
  readonly rawLength: number;
  readonly all: boolean;
  readonly terminated: boolean;
  readonly number: number;
  readonly offset: number;
}

class SlicedLine implements Line {
  rawLength: number;
  all: boolean;
  terminated: boolean;
  number: number;
  offset: number;
  private _bytes: Uint8Array | undefined;
  private _content: Buffer | undefined;
  private _rawBytes: Buffer | undefined;
  constructor(
    public chunk: Uint8Array,
    public start: number,
    public contentEnd: number,
    public rawEnd: number,
    public delimiterBuffer: Buffer | undefined,
    public searchEnd: number,
    all: boolean,
    terminated: boolean,
    number: number,
    offset: number,
  ) {
    this.rawLength = rawEnd - start + (delimiterBuffer ? 1 : 0);
    this.all = all;
    this.terminated = terminated;
    this.number = number;
    this.offset = offset;
  }
  reset(
    chunk: Uint8Array,
    start: number,
    contentEnd: number,
    rawEnd: number,
    delimiterBuffer: Buffer | undefined,
    searchEnd: number,
    all: boolean,
    terminated: boolean,
    number: number,
    offset: number,
  ): this {
    this.chunk = chunk;
    this.start = start;
    this.contentEnd = contentEnd;
    this.rawEnd = rawEnd;
    this.delimiterBuffer = delimiterBuffer;
    this.searchEnd = searchEnd;
    this.rawLength = rawEnd - start + (delimiterBuffer ? 1 : 0);
    this.all = all;
    this.terminated = terminated;
    this.number = number;
    this.offset = offset;
    this._bytes = undefined;
    this._content = undefined;
    this._rawBytes = undefined;
    return this;
  }
  clone(): SlicedLine {
    return new SlicedLine(this.chunk, this.start, this.contentEnd, this.rawEnd, this.delimiterBuffer, this.searchEnd, this.all, this.terminated, this.number, this.offset);
  }
  get bytes(): Uint8Array {
    return this._bytes ??= new Uint8Array(this.chunk.buffer, this.chunk.byteOffset + this.start, this.searchEnd - this.start);
  }
  get content(): Buffer {
    if (this._content) return this._content;
    const buf = Buffer.isBuffer(this.chunk) ? this.chunk : Buffer.from(this.chunk.buffer, this.chunk.byteOffset, this.chunk.byteLength);
    return this._content = buf.subarray(this.start, this.contentEnd);
  }
  get rawBytes(): Buffer {
    if (this._rawBytes) return this._rawBytes;
    const buf = Buffer.isBuffer(this.chunk) ? this.chunk : Buffer.from(this.chunk.buffer, this.chunk.byteOffset, this.chunk.byteLength);
    const content = buf.subarray(this.start, this.rawEnd);
    return this._rawBytes = this.delimiterBuffer ? Buffer.concat([content, this.delimiterBuffer]) : content;
  }
}

export interface ReadState { bytesRead: number; bytesSearched: number; binaryOffset: number | null; skipped: boolean }

const LF_DELIMITER_BUFFER = Buffer.from([10]);
const NUL_DELIMITER_BUFFER = Buffer.from([0]);
const EMPTY_BATCHES: Line[][] = [];
const reusableLines: SlicedLine[] = Array.from({ length: 128 }, () => new SlicedLine(Buffer.alloc(0), 0, 0, 0, undefined, 0, false, true, 0, 0));
const reusableBatchSlices: Line[][] = Array.from({ length: 129 }, (_, k) => {
  const arr = reusableLines.slice(0, k);
  trustedInputRows.add(arr);
  reusableBatchRows.add(arr);
  return arr;
});
const reusableSingleBatchWrapper: Line[][] = [[]];

function findDualDelimiter(chunk: Uint8Array, start: number, delimiter: number, extraDelimiter: number): number {
  for (let scan = start; scan < chunk.length; scan++) {
    if (chunk[scan] === delimiter || chunk[scan] === extraDelimiter) return scan;
  }
  return -1;
}

/** Pool reuse is only safe when the caller consumes every line without suspending. */
export function trySyncLineBatches(
  source: Uint8Array,
  limits: Limits,
  state: ReadState,
  binary: "skip" | "binary" | "text",
  nullData: boolean,
  maxRecords: () => number,
  needAll = false,
  crlf = false,
  reusePool = false,
): Line[][] | undefined {
  if (limits.tick() !== undefined) return undefined;
  const chunk = source;
  if (state.bytesRead + chunk.length > limits.maxFileBytes) throw new SearchError("input file byte limit exceeded");
  const delimiter = nullData ? 0 : 10;
  const extraDelimiter = binary === "binary" ? 0 : -1;
  const delimiterBuffer = nullData ? NUL_DELIMITER_BUFFER : LF_DELIMITER_BUFFER;
  const nul = nullData || binary === "text" ? -1 : chunk.indexOf(0);
  if (nul >= 0 && state.binaryOffset === null) state.binaryOffset = state.bytesRead + nul;
  state.bytesRead += chunk.length;
  if (nul >= 0 && binary === "skip") {
    state.skipped = true;
    return EMPTY_BATCHES;
  }
  let usingPool = reusePool && maxRecords() === 128;
  let poolCount = 0;
  let batches: Line[][] | undefined = usingPool ? undefined : [];
  let batch: Line[] | undefined = usingPool ? undefined : [];
  let batchBytes = 0;
  let offset = 0;
  let number = 0;
  let start = 0;
  let next = extraDelimiter === -1
    ? chunk.indexOf(delimiter, 0)
    : findDualDelimiter(chunk, 0, delimiter, extraDelimiter);
  while (next >= 0) {
    const end = next;
    if (end - start > limits.maxLineBytes) {
      state.bytesSearched = offset;
      throw new SearchError("line byte limit exceeded");
    }
    const searchEnd = crlf && end > start && chunk[end - 1] === 13 ? end - 1 : end;
    const isNormalDelimiter = chunk[end] === delimiter;
    const rawEnd = isNormalDelimiter ? end + 1 : end;
    const delimBuf = isNormalDelimiter ? undefined : delimiterBuffer;
    const line = usingPool
      ? reusableLines[poolCount++]!.reset(chunk, start, end, rawEnd, delimBuf, searchEnd, needAll, true, ++number, offset)
      : new SlicedLine(chunk, start, end, rawEnd, delimBuf, searchEnd, needAll, true, ++number, offset);
    if (!usingPool) batch!.push(line);
    batchBytes += end - start;
    offset += line.rawLength;
    start = end + 1;
    next = extraDelimiter === -1
      ? chunk.indexOf(delimiter, start)
      : findDualDelimiter(chunk, start, delimiter, extraDelimiter);
    const currentLen = usingPool ? poolCount : batch!.length;
    if (currentLen >= maxRecords() || batchBytes >= 64 * 1024 || next < 0 || batchBytes + next - start > 64 * 1024 || next - start > limits.maxLineBytes) {
      if (usingPool) {
        if (next < 0 && start >= chunk.length) {
          state.bytesSearched = offset;
          reusableSingleBatchWrapper[0] = reusableBatchSlices[poolCount]!;
          return reusableSingleBatchWrapper;
        }
        batches = [];
        const cloned: Line[] = new Array(poolCount);
        for (let i = 0; i < poolCount; i++) cloned[i] = reusableLines[i]!.clone();
        batches.push(cloned);
        batch = [];
        usingPool = false;
      } else {
        batches!.push(batch!);
        batch = [];
      }
      batchBytes = 0;
    }
  }
  state.bytesSearched = offset;
  if (start < chunk.length) {
    if (chunk.length - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
    const searchEnd = crlf && chunk.length > start && chunk[chunk.length - 1] === 13 ? chunk.length - 1 : chunk.length;
    if (usingPool && poolCount < 128) {
      const line = reusableLines[poolCount++]!.reset(chunk, start, chunk.length, chunk.length, undefined, searchEnd, needAll, false, ++number, offset);
      state.bytesSearched = offset + line.rawLength;
      reusableSingleBatchWrapper[0] = reusableBatchSlices[poolCount]!;
      return reusableSingleBatchWrapper;
    }
    if (usingPool) {
      batches = [];
      const cloned: Line[] = new Array(poolCount);
      for (let i = 0; i < poolCount; i++) cloned[i] = reusableLines[i]!.clone();
      batches.push(cloned);
      batch = [];
      usingPool = false;
    }
    const line = new SlicedLine(chunk, start, chunk.length, chunk.length, undefined, searchEnd, needAll, false, ++number, offset);
    state.bytesSearched = offset + line.rawLength;
    batch!.push(line);
  }
  if (usingPool) {
    if (poolCount === 0) return EMPTY_BATCHES;
    reusableSingleBatchWrapper[0] = reusableBatchSlices[poolCount]!;
    return reusableSingleBatchWrapper;
  }
  if (batch && batch.length) batches!.push(batch);
  return batches ?? EMPTY_BATCHES;
}

export async function* lineBatches(
  source: ByteSource | Uint8Array,
  limits: Limits,
  state: ReadState,
  binary: "skip" | "binary" | "text",
  nullData: boolean,
  maxRecords: () => number,
  needAll = false,
  crlf = false,
): AsyncGenerator<Line[]> {
  let pending: Buffer = emptyBuffer;
  let offset = 0;
  let number = 0;
  let batch: Line[] = [];
  let batchBytes = 0;
  const delimiter = nullData ? 0 : 10;
  const extraDelimiter = binary === "binary" ? 0 : -1;
  const delimiterBuffer = nullData ? NUL_DELIMITER_BUFFER : LF_DELIMITER_BUFFER;
  const chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> = source instanceof Uint8Array ? [source] : readBytes(source, limits.signal);
  for await (const data of chunks) {
    const tickPending = limits.tick();
    if (tickPending) await tickPending;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (state.bytesRead + chunk.length > limits.maxFileBytes) throw new SearchError("input file byte limit exceeded");
    const nul = nullData || binary === "text" ? -1 : chunk.indexOf(0);
    if (nul >= 0 && state.binaryOffset === null) state.binaryOffset = state.bytesRead + nul;
    state.bytesRead += chunk.length;
    if (nul >= 0 && binary === "skip") {
      state.skipped = true;
      if (batch.length) yield batch;
      return;
    }
    let start = 0;
    let next = extraDelimiter === -1
      ? chunk.indexOf(delimiter, 0)
      : (() => {
          for (let scan = 0; scan < chunk.length; scan++) {
            if (chunk[scan] === delimiter || chunk[scan] === extraDelimiter) return scan;
          }
          return -1;
        })();
    while (next >= 0) {
      const end = next;
      if (pending.length + end - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
      if (pending.length === 0) {
        const searchEnd = crlf && end > start && chunk[end - 1] === 13 ? end - 1 : end;
        const isNormalDelimiter = chunk[end] === delimiter;
        const line = new SlicedLine(
          chunk,
          start,
          end,
          isNormalDelimiter ? end + 1 : end,
          isNormalDelimiter ? undefined : delimiterBuffer,
          searchEnd,
          needAll,
          true,
          ++number,
          offset,
        );
        state.bytesSearched = offset + line.rawLength;
        batch.push(line);
        batchBytes += end - start;
        offset += line.rawLength;
      } else {
        const content = Buffer.concat([pending, chunk.subarray(start, end)]);
        const rawBytes = Buffer.concat([content, delimiterBuffer]);
        const searchBytes = crlf && content.length > 0 && content[content.length - 1] === 13 ? content.subarray(0, content.length - 1) : content;
        const line: Line = {
          bytes: searchBytes,
          content,
          rawBytes,
          rawLength: rawBytes.length,
          all: needAll,
          terminated: true,
          number: ++number,
          offset,
        };
        state.bytesSearched = offset + rawBytes.length;
        batch.push(line);
        batchBytes += content.length;
        offset += rawBytes.length;
        pending = emptyBuffer;
      }
      start = end + 1;
      next = extraDelimiter === -1
        ? chunk.indexOf(delimiter, start)
        : (() => {
            for (let scan = start; scan < chunk.length; scan++) {
              if (chunk[scan] === delimiter || chunk[scan] === extraDelimiter) return scan;
            }
            return -1;
          })();
      if (
        batch.length >= maxRecords() ||
        batchBytes >= 64 * 1024 ||
        next < 0 ||
        batchBytes + next - start > 64 * 1024 ||
        next - start > limits.maxLineBytes
      ) {
        yield batch;
        batch = [];
        batchBytes = 0;
      }
    }
    if (pending.length + chunk.length - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
    if (start < chunk.length) {
      const tail = chunk.subarray(start);
      pending = pending.length === 0 ? Buffer.from(tail) : Buffer.concat([pending, tail]);
    }
  }
  if (pending.length) {
    state.bytesSearched = offset + pending.length;
    const searchBytes = crlf && pending.length > 0 && pending[pending.length - 1] === 13 ? pending.subarray(0, pending.length - 1) : pending;
    batch.push({
      bytes: searchBytes,
      content: pending,
      rawBytes: pending,
      rawLength: pending.length,
      all: needAll,
      terminated: false,
      number: ++number,
      offset,
    });
  }
  if (batch.length) yield batch;
}
