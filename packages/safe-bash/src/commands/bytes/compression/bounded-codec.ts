import { PublicDiagnostic } from "../../../diagnostics.js";
import { yieldTurn } from "../../../contracts/yield.js";
import type { CodecInput } from "./codec.js";
import { createCodec } from "./codec-loader.js";

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
  readonly decompress: boolean;
  readonly level: number;
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
  let output = new Uint8Array(64 * 1024);
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
      }
      const bytes = current.subarray(offset, Math.min(current.length, offset + 64 * 1024));
      const result = stream.step(bytes, output, eof);
      signal.throwIfAborted();
      if (!Number.isSafeInteger(result.consumed) || result.consumed < 0 || result.consumed > bytes.length ||
          !Number.isSafeInteger(result.produced) || result.produced < 0 || result.produced > output.length ||
          !["input", "output", "end"].includes(result.status)) {
        throw new Error("invalid codec progress");
      }
      offset += result.consumed;
      if (!result.consumed && !result.produced && result.status !== "end") {
        if (eof) throw new PublicDiagnostic("unexpected end of file");
        if (bytes.length || result.status !== "input") throw new Error("codec made no progress");
      }
      if (result.produced) {
        yield output.subarray(0, result.produced);
        signal.throwIfAborted();
        output = new Uint8Array(64 * 1024);
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
        ended = true;
      }
      needsInput = result.status !== "output";
    }
  } catch (error) {
    failed = true;
    options.onFailure?.(error);
    throw error;
  } finally {
    try { stream?.close(); }
    catch (error) { if (!failed) throw error; }
  }
}
