import { publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { hasYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
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

export class Limits {
  readonly maxOutputBytes: number;
  readonly maxLineBytes: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxPatternBytes: number;
  outputBytes = 0;
  files = 0;
  private ticks = 0;
  private readonly stopped = new AbortController();
  readonly signal: AbortSignal;
  private outBuf: Uint8Array | null = null;
  private outPos = 0;
  constructor(readonly context: CommandContext, options: SearchOptions) {
    this.signal = AbortSignal.any([context.signal, this.stopped.signal]);
    this.maxOutputBytes = options.maxOutputBytes ?? Infinity;
    this.maxLineBytes = options.maxLineBytes ?? Infinity;
    this.maxFileBytes = options.maxFileBytes ?? Infinity;
    this.maxFiles = options.maxFiles ?? Infinity;
    this.maxPatternBytes = options.maxPatternBytes ?? Infinity;
    for (const limit of [this.maxOutputBytes, this.maxLineBytes, this.maxFileBytes, this.maxFiles, this.maxPatternBytes]) {
      if ((limit !== Infinity && !Number.isSafeInteger(limit)) || limit < 1) throw new SearchError("search limits must be positive safe integers");
    }
  }
  tick(): Promise<void> | undefined {
    this.context.signal.throwIfAborted();
    const interval = hasYieldCheckpoint(this.context.signal) ? 128 : 2048;
    if (++this.ticks % interval === 0) return yieldTurn(this.context.signal);
    return undefined;
  }
  private async write(chunk: Uint8Array): Promise<void> {
    try { await writeBytes(this.context.stdout, chunk, this.signal); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if ((error as { code?: string }).code === "EPIPE") {
        const closed = new OutputClosed("stdout closed"); this.stopped.abort(closed); throw closed;
      }
      throw error;
    }
  }
  async flush(): Promise<void> {
    if (this.outPos > 0 && this.outBuf) {
      const slice = this.outBuf.subarray(0, this.outPos);
      this.outPos = 0;
      await this.write(slice);
    }
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
        let buf = this.outBuf;
        if (!buf) buf = this.outBuf = new Uint8Array(OUT_BUFFER_SIZE);
        if (this.outPos + len > OUT_BUFFER_SIZE) {
          await this.flush();
        }
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
    let buf = this.outBuf;
    if (!buf) buf = this.outBuf = new Uint8Array(OUT_BUFFER_SIZE);
    if (this.outPos + chunk.byteLength > OUT_BUFFER_SIZE) {
      await this.flush();
    }
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
  readonly bytes: Uint8Array;
  readonly rawLength: number;
  readonly all: boolean;
  readonly terminated: boolean;
  readonly number: number;
  readonly offset: number;
  #content: Buffer | undefined;
  #rawBytes: Buffer | undefined;
  constructor(
    private readonly chunk: Buffer,
    private readonly start: number,
    private readonly contentEnd: number,
    private readonly rawEnd: number,
    private readonly delimiterBuffer: Buffer | undefined,
    searchEnd: number,
    all: boolean,
    terminated: boolean,
    number: number,
    offset: number,
  ) {
    this.bytes = new Uint8Array(chunk.buffer, chunk.byteOffset + start, searchEnd - start);
    this.rawLength = rawEnd - start + (delimiterBuffer ? 1 : 0);
    this.all = all;
    this.terminated = terminated;
    this.number = number;
    this.offset = offset;
  }
  get content(): Buffer {
    return this.#content ??= this.chunk.subarray(this.start, this.contentEnd);
  }
  get rawBytes(): Buffer {
    if (this.#rawBytes) return this.#rawBytes;
    const content = this.chunk.subarray(this.start, this.rawEnd);
    return this.#rawBytes = this.delimiterBuffer ? Buffer.concat([content, this.delimiterBuffer]) : content;
  }
}

export interface ReadState { bytesRead: number; bytesSearched: number; binaryOffset: number | null; skipped: boolean }

const LF_DELIMITER_BUFFER = Buffer.from([10]);
const NUL_DELIMITER_BUFFER = Buffer.from([0]);

export function trySyncLineBatches(
  source: Uint8Array,
  limits: Limits,
  state: ReadState,
  binary: "skip" | "binary" | "text",
  nullData: boolean,
  maxRecords: () => number,
  needAll = false,
  crlf = false,
): Line[][] | undefined {
  if (limits.tick() !== undefined) return undefined;
  const chunk = Buffer.isBuffer(source) ? source : Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (state.bytesRead + chunk.length > limits.maxFileBytes) throw new SearchError("input file byte limit exceeded");
  const delimiter = nullData ? 0 : 10;
  const extraDelimiter = binary === "binary" ? 0 : -1;
  const delimiterBuffer = nullData ? NUL_DELIMITER_BUFFER : LF_DELIMITER_BUFFER;
  const nul = nullData || binary === "text" ? -1 : chunk.indexOf(0);
  if (nul >= 0 && state.binaryOffset === null) state.binaryOffset = state.bytesRead + nul;
  state.bytesRead += chunk.length;
  if (nul >= 0 && binary === "skip") {
    state.skipped = true;
    return [];
  }
  const batches: Line[][] = [];
  let batch: Line[] = [];
  let batchBytes = 0;
  let offset = 0;
  let number = 0;
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
    if (end - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
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
    start = end + 1;
    next = extraDelimiter === -1
      ? chunk.indexOf(delimiter, start)
      : (() => {
          for (let scan = start; scan < chunk.length; scan++) {
            if (chunk[scan] === delimiter || chunk[scan] === extraDelimiter) return scan;
          }
          return -1;
        })();
    if (batch.length >= maxRecords() || batchBytes >= 64 * 1024 || next < 0 || batchBytes + next - start > 64 * 1024 || next - start > limits.maxLineBytes) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
  }
  if (start < chunk.length) {
    if (chunk.length - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
    const searchEnd = crlf && chunk.length > start && chunk[chunk.length - 1] === 13 ? chunk.length - 1 : chunk.length;
    const line = new SlicedLine(chunk, start, chunk.length, chunk.length, undefined, searchEnd, needAll, false, ++number, offset);
    state.bytesSearched = offset + line.rawLength;
    batch.push(line);
  }
  if (batch.length) batches.push(batch);
  return batches;
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
