import {
  ZStream, Z_OK, Z_STREAM_END, Z_BUF_ERROR, Z_DATA_ERROR, Z_NO_FLUSH, Z_FINISH,
  zlibDeflateInit2, zlibDeflate, zlibDeflateEnd,
  zlibInflateInit2, zlibInflate, zlibInflateReset, zlibInflateEnd,
} from "pako";
import { PublicDiagnostic } from "../../../diagnostics.js";
import { readBytes, type ByteSource } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { compressionDiagnostic } from "./errors.js";

export interface CodecInput {
  chunk(): Promise<Uint8Array | undefined>;
  restore(bytes: Uint8Array): void;
}

export class CodecReader implements CodecInput {
  private readonly iterator: AsyncGenerator<Uint8Array>;
  private pending: Uint8Array = new Uint8Array();
  private pulls = 0;
  private closing: Promise<void> | undefined;
  constructor(source: ByteSource, private readonly signal: AbortSignal) { this.iterator = readBytes(source, signal); }
  async chunk(): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted();
    if (this.closing) return undefined;
    if (this.pending.length) { const bytes = this.pending; this.pending = new Uint8Array(); return bytes; }
    for (;;) {
      if (++this.pulls % 64 === 0) await yieldTurn(this.signal);
      const next = await this.iterator.next();
      if (next.done) return undefined;
      if (next.value.length) return next.value;
    }
  }
  restore(bytes: Uint8Array): void { this.pending = bytes; }
  close(): Promise<void> {
    this.pending = new Uint8Array();
    return this.closing ??= this.iterator.return(undefined).then(() => {});
  }
}

interface CodecOptions {
  readonly mode: "gzip" | "gunzip" | "inflate-raw" | "deflate-raw";
  readonly chunkSize?: number;
  readonly level?: number;
  readonly onFailure?: (error: unknown) => void;
}

function codecError(status: number, message: string): unknown {
  const error = new Error(message || "internal error");
  Object.assign(error, { code: status === Z_BUF_ERROR ? "Z_BUF_ERROR" : status === Z_DATA_ERROR ? "Z_DATA_ERROR" : "Z_STREAM_ERROR" });
  return compressionDiagnostic(error);
}

export async function* codec(input: CodecInput, options: CodecOptions, signal: AbortSignal): ByteSource {
  signal.throwIfAborted();
  const requestedSize = options.chunkSize ?? 64 * 1024;
  if (!Number.isSafeInteger(requestedSize) || requestedSize <= 0) throw new RangeError("invalid codec chunk size");
  const chunkSize = Math.min(requestedSize, 64 * 1024);
  let output = new Uint8Array(chunkSize);
  const encoding = options.mode === "gzip" || options.mode === "deflate-raw";
  const stream = new ZStream();
  const initialized = encoding
    ? zlibDeflateInit2(stream, options.level ?? 6, 8, options.mode === "deflate-raw" ? -15 : 31, 8, 0, true)
    : zlibInflateInit2(stream, options.mode === "inflate-raw" ? -15 : 31);
  if (initialized !== Z_OK) {
    if (encoding) zlibDeflateEnd(stream);
    else zlibInflateEnd(stream);
    throw codecError(initialized, stream.msg);
  }
  let current: Uint8Array = new Uint8Array();
  let offset = 0;
  let eof = false;
  let needsInput = true;
  let memberEnded = false;
  let calls = 0;
  let work = 0;
  let filled = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      if (needsInput || memberEnded) {
        if (offset === current.length && !eof) {
          let ready = false;
          const pending = input.chunk().then(value => { ready = true; return value; }, error => {
            options.onFailure?.(error);
            throw error;
          });
          if (filled) {
            const turn = new AbortController();
            try { await Promise.race([pending, yieldTurn(AbortSignal.any([signal, turn.signal]))]); }
            finally { turn.abort(); }
            if (!ready) {
              yield output.subarray(0, filled);
              output = new Uint8Array(chunkSize);
              filled = 0;
              signal.throwIfAborted();
            }
          }
          current = await pending ?? new Uint8Array();
          offset = 0;
          eof = current.length === 0;
        }
        if (memberEnded) {
          if (eof) return;
          if (current[offset] === 0) {
            while (await input.chunk() !== undefined) await yieldTurn(signal);
            return;
          }
          const reset = zlibInflateReset(stream);
          if (reset !== Z_OK) throw codecError(reset, stream.msg);
          memberEnded = false;
        }
        stream.input = current;
        stream.next_in = offset;
        stream.avail_in = Math.min(current.length - offset, 64 * 1024);
      }
      stream.output = output;
      stream.next_out = filled;
      stream.avail_out = chunkSize - filled;
      const before = stream.avail_in;
      const status = encoding ? zlibDeflate(stream, eof ? Z_FINISH : Z_NO_FLUSH) : zlibInflate(stream, Z_NO_FLUSH);
      offset = stream.next_in;
      const consumed = before - stream.avail_in;
      const produced = stream.next_out - filled;
      filled = stream.next_out;
      if (status !== Z_OK && status !== Z_STREAM_END && status !== Z_BUF_ERROR) throw codecError(status, stream.msg);
      if (filled === chunkSize || status === Z_STREAM_END && filled) {
        yield output.subarray(0, filled);
        output = new Uint8Array(chunkSize);
        filled = 0;
      }
      signal.throwIfAborted();
      work += consumed + produced;
      if (++calls >= 64 || work >= 64 * 1024) { await yieldTurn(signal); calls = 0; work = 0; }
      if (status === Z_STREAM_END) {
        if (options.mode === "inflate-raw") { input.restore(current.subarray(offset)); return; }
        if (encoding) return;
        memberEnded = true;
      }
      if (!consumed && !produced && status !== Z_STREAM_END) {
        if (eof) throw new PublicDiagnostic("unexpected end of file");
        if (stream.avail_in) throw codecError(status, stream.msg);
      }
      needsInput = stream.avail_in === 0 && stream.avail_out !== 0;
    }
  } catch (error) {
    options.onFailure?.(error);
    throw error;
  } finally {
    if (encoding) zlibDeflateEnd(stream);
    else zlibInflateEnd(stream);
    stream.input = new Uint8Array();
    stream.output = new Uint8Array();
  }
}
