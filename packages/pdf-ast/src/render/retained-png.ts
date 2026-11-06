import { readBytes } from "@poe-code/safe-fs/contracts";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { deflatePngPixels, framePngChunks } from "./png-stream.js";

export interface PdfRetainedPngOptions {
  readonly chunkBytes?: number;
  /** Aggregate live pixel and compressed staging bytes. */
  readonly maxStagingBytes?: number;
  readonly maxOutputBytes?: number;
  /** Auto omits alpha only when every input alpha sample is opaque. */
  readonly alpha?: "auto" | "rgba";
  readonly signal?: AbortSignal;
}
function maximum(value: number | undefined): number {
  const result = value ?? Infinity;
  if (result !== Infinity && (!Number.isSafeInteger(result) || result < 0)) throw new RangeError("Invalid PNG byte limit");
  return Math.min(result, Number.MAX_SAFE_INTEGER);
}

/** Document-owner orchestration around pure PNG codecs. Pixel inspection and
 * compressed-length discovery use only caller-authorized retained staging. */
export async function* encodeRetainedPng(width: number, height: number, input: AsyncIterable<Uint8Array>, storage: PdfIndexStorage,
  options: PdfRetainedPngOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  const { signal } = options; signal?.throwIfAborted();
  if (options.alpha !== undefined && options.alpha !== "auto" && options.alpha !== "rgba") throw new RangeError("Invalid PNG alpha mode");
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff) || !Number.isSafeInteger(width * height * 4)) throw new PdfError("E_LIMIT", "PNG dimension limit exceeded");
  const chunkBytes = options.chunkBytes ?? 65536;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("Invalid PNG chunk size");
  const stagingLimit = maximum(options.maxStagingBytes); const outputLimit = maximum(options.maxOutputBytes);
  if (outputLimit < 57) throw new PdfError("E_LIMIT", "PNG output byte limit exceeded");
  let opaque = options.alpha !== "rgba"; let inputBytes = 0;
  const expected = width * height * 4;
  let pixels: PdfFileSource | undefined; let compressed: PdfFileSource | undefined; let failed = false;
  async function* inspect(): AsyncGenerator<Uint8Array> {
    for await (const bytes of readBytes(input, signal)) {
      if (bytes.length > Number.MAX_SAFE_INTEGER - inputBytes) throw new PdfError("E_LIMIT", "PNG input byte limit exceeded");
      if (opaque) for (let at = (3 - inputBytes % 4 + 4) % 4; at < bytes.length; at += 4) {
        if (bytes[at] !== 255) { opaque = false; break; }
        if (at > 0 && at % 1048576 < 4) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      }
      const take = Math.max(0, Math.min(bytes.length, expected - inputBytes)); inputBytes += bytes.length;
      if (take) yield bytes.subarray(0, take);
    }
  }
  try {
    pixels = await PdfFileSource.fromStream(storage.fs, storage.directory, inspect(), { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: stagingLimit, ...(signal ? { signal } : {}) });
    opaque &&= inputBytes >= height * (width * 3 + 1);
    compressed = await PdfFileSource.fromStream(storage.fs, storage.directory,
      deflatePngPixels(width, height, pixels.stream(0, pixels.size, signal), opaque, chunkBytes, signal),
      { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: Math.min(stagingLimit - pixels.size, outputLimit - 57, 0xffffffff), ...(signal ? { signal } : {}) });
    await pixels.close(); pixels = undefined;
    yield* framePngChunks(width, height, opaque, compressed.size, compressed.stream(0, compressed.size, signal), chunkBytes, signal);
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([compressed?.close(), pixels?.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
