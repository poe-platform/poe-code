import {
  ZStream, Z_OK, Z_STREAM_END, Z_BUF_ERROR, Z_NO_FLUSH, Z_FINISH,
  zlibDeflateInit2, zlibDeflate, zlibDeflateEnd,
  zlibInflateInit2, zlibInflate, zlibInflateReset, zlibInflateEnd
} from "pako";

export interface ByteCodecOptions {
  readonly direction: "encode" | "decode";
  readonly format: "raw" | "zlib" | "gzip" | "zlib-or-gzip";
  readonly chunkSize?: number;
  readonly level?: number;
}

export class ByteCodecError extends Error {
  constructor(readonly code: "invalid" | "truncated", message: string) {
    super(message);
    this.name = "ByteCodecError";
  }
}

export interface ByteCodec {
  readonly complete: boolean;
  /** Bytes consumed from the most recent push; trailing bytes remain with the caller. */
  readonly consumed: number;
  /** Drain or return this iterator before another push. Each yielded chunk is owned. */
  push(input: Uint8Array, final?: boolean): Generator<Uint8Array>;
  close(): void;
}

/** Synchronous bounded steps for callers that already own byte buffers. Gzip accepts concatenated members and terminal zero padding. */
export function createByteCodec(options: ByteCodecOptions): ByteCodec {
  const requested = options.chunkSize ?? 64 * 1024;
  if (!Number.isSafeInteger(requested) || requested <= 0) throw new RangeError("invalid codec chunk size");
  const chunkSize = Math.min(requested, 64 * 1024);
  if (options.direction !== "encode" && options.direction !== "decode") throw new RangeError("invalid codec direction");
  const encode = options.direction === "encode";
  if (encode && options.format === "zlib-or-gzip") throw new RangeError("zlib-or-gzip is decode-only");
  const bits = ({ raw: -15, zlib: 15, gzip: 31, "zlib-or-gzip": 47 } as const)[options.format];
  if (typeof bits !== "number") throw new RangeError("invalid codec format");
  const stream = new ZStream();
  const status = encode ? zlibDeflateInit2(stream, options.level ?? 6, 8, bits, 8, 0, true) : zlibInflateInit2(stream, bits);
  let closed = false;
  let complete = false;
  let active = false;
  let consumed = 0;
  let memberEnded = false;
  let padding = false;
  function close(): void {
    if (closed) return;
    closed = true;
    if (encode) zlibDeflateEnd(stream);
    else zlibInflateEnd(stream);
    stream.input = new Uint8Array();
    stream.output = new Uint8Array();
  }
  if (status !== Z_OK) {
    close();
    throw new ByteCodecError("invalid", stream.msg || "invalid codec options");
  }
  return {
    get complete() { return complete; },
    get consumed() { return consumed; },
    close,
    *push(input, final = false) {
      if (closed) throw new Error("codec is closed");
      if (active) throw new Error("codec push is already active");
      if (complete) throw new Error("codec is complete");
      active = true;
      let drained = false;
      consumed = 0;
      try {
        do {
          if (memberEnded) {
            if (consumed === input.length) { complete = final; drained = true; return; }
            if (padding || input[consumed] === 0) {
              padding = true;
              consumed = input.length;
              complete = final;
              drained = true;
              return;
            }
            const reset = zlibInflateReset(stream);
            if (reset !== Z_OK) throw new ByteCodecError("invalid", stream.msg || "invalid gzip member");
            memberEnded = false;
          }
          stream.input = input;
          stream.next_in = consumed;
          stream.avail_in = Math.min(input.length - consumed, 64 * 1024);
          const last = final && consumed + stream.avail_in === input.length;
          const output = new Uint8Array(chunkSize);
          stream.output = output;
          stream.next_out = 0;
          stream.avail_out = output.length;
          const before = stream.next_in;
          const result = encode ? zlibDeflate(stream, last ? Z_FINISH : Z_NO_FLUSH) : zlibInflate(stream, Z_NO_FLUSH);
          consumed = stream.next_in;
          const produced = stream.next_out;
          if (result !== Z_OK && result !== Z_STREAM_END && result !== Z_BUF_ERROR) {
            throw new ByteCodecError("invalid", stream.msg || "invalid compressed data");
          }
          if (produced) yield output.subarray(0, produced);
          if (result === Z_STREAM_END) {
            // Only gzip admits subsequent wrapped members. Explicit gzip remains
            // strict; the compatibility selection also admits a following zlib member.
            const gzipMember = (stream.state as { flags: number } | null)?.flags !== 0;
            if (!encode && (options.format === "gzip" || options.format === "zlib-or-gzip" && gzipMember)) {
              memberEnded = true;
              continue;
            }
            complete = true; drained = true; return;
          }
          if (consumed === before && !produced) {
            if (final) throw new ByteCodecError("truncated", "unexpected end of file");
            if (consumed < input.length) throw new ByteCodecError("invalid", stream.msg || "invalid compressed data");
            break;
          }
          if (!final && consumed === input.length && stream.avail_out) break;
        } while (true);
        drained = true;
      } finally {
        active = false;
        stream.input = new Uint8Array();
        stream.output = new Uint8Array();
        if (!drained) close();
      }
    }
  };
}

/** In-memory convenience only. File workflows should use createCompressionCodec. */
export function transformBytes(input: Uint8Array, options: ByteCodecOptions): Uint8Array {
  const codec = createByteCodec(options);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (const chunk of codec.push(input, true)) {
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally { codec.close(); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
