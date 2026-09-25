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
  async output(value: string | Uint8Array): Promise<void> {
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    if (this.outputBytes + chunk.byteLength > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
    await this.write(chunk);
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

export interface Line { readonly bytes: Buffer; readonly content: Buffer; readonly number: number; readonly offset: number }
export interface ReadState { bytesRead: number; bytesSearched: number; binaryOffset: number | null; skipped: boolean }

export async function* lines(source: ByteSource, limits: Limits, state: ReadState, binary: "skip" | "binary" | "text", nullData: boolean): AsyncGenerator<Line> {
  let pending: Buffer = emptyBuffer;
  let offset = 0;
  let number = 0;
  const delimiter = nullData ? 0 : 10;
  const delimiterBuffer = Buffer.from([delimiter]);
  for await (const data of readBytes(source, limits.signal)) {
    const tickPending = limits.tick();
    if (tickPending) await tickPending;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (state.bytesRead + chunk.length > limits.maxFileBytes) throw new SearchError("input file byte limit exceeded");
    const nul = nullData || binary === "text" ? -1 : chunk.indexOf(0);
    if (nul >= 0 && state.binaryOffset === null) state.binaryOffset = state.bytesRead + nul;
    state.bytesRead += chunk.length;
    if (nul >= 0 && binary === "skip") { state.skipped = true; return; }
    let start = 0;
    for (let end = 0; end < chunk.length; end++) {
      if (chunk[end] !== delimiter && !(binary === "binary" && chunk[end] === 0)) continue;
      if (pending.length + end - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
      let content: Buffer;
      let bytes: Buffer;
      if (pending.length === 0 && chunk[end] === delimiter) {
        content = chunk.subarray(start, end);
        bytes = chunk.subarray(start, end + 1);
      } else {
        content = pending.length === 0 ? chunk.subarray(start, end) : Buffer.concat([pending, chunk.subarray(start, end)]);
        bytes = Buffer.concat([content, delimiterBuffer]);
      }
      state.bytesSearched = offset + bytes.length;
      yield { content, bytes, number: ++number, offset };
      offset += bytes.length; pending = emptyBuffer; start = end + 1;
    }
    if (pending.length + chunk.length - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
    if (start < chunk.length) {
      const tail = chunk.subarray(start);
      pending = pending.length === 0 ? Buffer.from(tail) : Buffer.concat([pending, tail]);
    }
  }
  if (pending.length) { state.bytesSearched = offset + pending.length; yield { bytes: pending, content: pending, number: ++number, offset }; }
}
export async function* lineBatches(
  source: ByteSource,
  limits: Limits,
  state: ReadState,
  binary: "skip" | "binary" | "text",
  nullData: boolean,
  maxRecords: () => number,
): AsyncGenerator<Line[]> {
  let pending: Buffer = emptyBuffer;
  let offset = 0;
  let number = 0;
  let batch: Line[] = [];
  let batchBytes = 0;
  const delimiter = nullData ? 0 : 10;
  const extraDelimiter = binary === "binary" ? 0 : -1;
  const delimiterBuffer = Buffer.from([delimiter]);
  for await (const data of readBytes(source, limits.signal)) {
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
      let content: Buffer;
      let bytes: Buffer;
      if (pending.length === 0 && chunk[end] === delimiter) {
        content = chunk.subarray(start, end);
        bytes = chunk.subarray(start, end + 1);
      } else {
        content = pending.length === 0 ? chunk.subarray(start, end) : Buffer.concat([pending, chunk.subarray(start, end)]);
        bytes = Buffer.concat([content, delimiterBuffer]);
      }
      state.bytesSearched = offset + bytes.length;
      batch.push({ content, bytes, number: ++number, offset });
      batchBytes += content.length;
      offset += bytes.length;
      pending = emptyBuffer;
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
    batch.push({ bytes: pending, content: pending, number: ++number, offset });
  }
  if (batch.length) yield batch;
}
