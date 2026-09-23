import { PublicDiagnostic } from "../../../diagnostics.js";
import { yieldTurn } from "../../../contracts/yield.js";
import type { CodecInput } from "./codec.js";
import { createCodec } from "./codec-loader.js";
import { CompressedDataError } from "./errors.js";
import type { ZstdOptions } from "./options.js";

export interface CodecStep {
  readonly consumed: number;
  readonly produced: number;
  readonly status: "input" | "output" | "end";
}

export interface BoundedCodec {
  step(input: Uint8Array, output: Uint8Array, finish: boolean): CodecStep;
  close(): void;
}

export interface BoundedCodecOptions {
  readonly format: "bzip2" | "xz" | "zstd";
  /** Explicit raw LZMA1 configuration for the liblzma asset; no XZ framing. */
  readonly lzma?: Readonly<{ dictionary: number; properties: number; eos: boolean; size: number }>;
  readonly decompress: boolean;
  readonly level: number;
  readonly extreme?: boolean;
  readonly xzDecompressMemory?: number | undefined;
  readonly xzFormat?: "auto" | "xz" | undefined;
  /** bzip2's reduced-memory decoder. */
  readonly small?: boolean | undefined;
  readonly zstd?: ZstdOptions | undefined;
  /** Stop at the first frame and return unread bytes to the input reader. */
  readonly singleMember?: boolean;
  readonly onFailure?: (error: unknown) => void;
}

export type CodecFactory = (options: BoundedCodecOptions, signal: AbortSignal) => BoundedCodec | Promise<BoundedCodec>;

/** Drives one bounded codec call at a time; the consumer owns each published slab. */
export async function* boundedCodec(
  input: CodecInput,
  options: BoundedCodecOptions,
  signal: AbortSignal,
  create: CodecFactory = createCodec,
): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  let stream: BoundedCodec | undefined;
  let current: Uint8Array = new Uint8Array();
  let offset = 0;
  let eof = false;
  let needsInput = true;
  let ended = false;
  let calls = 0;
  let work = 0;
  let failed = false;
  let headerOffset = 0;
  // bzip2's CLI publishes full 5000-byte reads, or the final successful read.
  const bufferReads = options.format === "bzip2" && options.decompress;
  let output = new Uint8Array(bufferReads ? 5000 : 64 * 1024);
  let buffered = 0;
  try {
    stream = await create(options, signal);
    for (;;) {
      signal.throwIfAborted();
      if ((needsInput || ended) && offset === current.length && !eof) {
        current = await input.chunk() ?? new Uint8Array();
        offset = 0;
        eof = current.length === 0;
        signal.throwIfAborted();
      }
      if (ended) {
        if (options.format === "xz") {
          let padding = 0;
          while (!eof) {
            while (offset < current.length && current[offset] === 0) {
              offset++;
              padding = (padding + 1) % 4;
              if (++work >= 64 * 1024) { await yieldTurn(signal); work = 0; calls = 0; }
            }
            if (offset < current.length) break;
            current = await input.chunk() ?? new Uint8Array();
            offset = 0;
            eof = current.length === 0;
            signal.throwIfAborted();
          }
          if (padding) throw new PublicDiagnostic("invalid XZ stream padding");
        }
        if (eof) return;
        const previous = stream;
        stream = undefined;
        previous.close();
        stream = await create(options, signal);
        signal.throwIfAborted();
        ended = false;
        headerOffset = 0;
      }
      const bytes = current.subarray(offset, Math.min(current.length, offset + 64 * 1024));
      if (options.format === "xz" && options.decompress && options.xzFormat === "xz") {
        const magic = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0];
        for (let index = 0; index < bytes.length && headerOffset + index < magic.length; index++) {
          if (bytes[index] !== magic[headerOffset + index]) throw new CompressedDataError("File format not recognized");
        }
      }
      const available = output.subarray(buffered);
      const result = stream.step(bytes, available, eof);
      signal.throwIfAborted();
      if (!Number.isSafeInteger(result.consumed) || result.consumed < 0 || result.consumed > bytes.length ||
          !Number.isSafeInteger(result.produced) || result.produced < 0 || result.produced > available.length ||
          !["input", "output", "end"].includes(result.status)) {
        throw new Error("invalid codec progress");
      }
      headerOffset = Math.min(6, headerOffset + result.consumed);
      offset += result.consumed;
      if (!result.consumed && !result.produced && result.status !== "end") {
        if (eof) throw new CompressedDataError("unexpected end of file");
        if (bytes.length || result.status !== "input") throw new Error("codec made no progress");
      }
      buffered += result.produced;
      if (buffered && (!bufferReads || buffered === output.length || result.status === "end")) {
        yield output.subarray(0, buffered);
        signal.throwIfAborted();
        output = new Uint8Array(output.length);
        buffered = 0;
      }
      signal.throwIfAborted();
      work += result.consumed + result.produced;
      if (++calls >= 64 || work >= 64 * 1024) {
        await yieldTurn(signal);
        calls = 0;
        work = 0;
      }
      if (result.status === "end") {
        if (!options.decompress) return;
        if (options.singleMember) {
          input.restore(current.subarray(offset));
          return;
        }
        ended = true;
      }
      needsInput = result.status !== "output";
    }
  } catch (error) {
    failed = true;
    options.onFailure?.(error);
    throw error;
  } finally {
    if (failed) {
      try { stream?.close(); } catch { /* Preserve the original failure. */ }
    } else {
      stream?.close();
    }
  }
}
