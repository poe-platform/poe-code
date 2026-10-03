import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import type { TiffCompressionMode } from "./raster.js";
import { createTiffHeader, encodeTiffStripChunks } from "./tiff-stream.js";

export interface PdfRetainedTiffOptions {
  readonly compression?: TiffCompressionMode;
  readonly dpi?: number;
  readonly chunkBytes?: number;
  readonly maxStagingBytes?: number;
  readonly maxOutputBytes?: number;
  /** Conservative owned row/codec scratch admission. Caller input chunks and
   * safe-fs source caches are additional memory. */
  readonly maxWorkingBytes?: number;
  readonly signal?: AbortSignal;
}
function maximum(value: number | undefined) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid TIFF byte limit");
  return value;
}
/** Stages a single compressed strip in caller-authorized storage to determine
 * its length before publishing the TIFF header. No full bitmap is collected. */
export async function* encodeRetainedTiff(width: number, height: number, input: AsyncIterable<Uint8Array>, storage: PdfIndexStorage,
  options: PdfRetainedTiffOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  const compression = options.compression ?? "none";
  const tags = { none: 1, packbits: 32773, deflate: 8, lzw: 5, jpeg: 7 };
  if (!Object.hasOwn(tags, compression)) throw new RangeError("Invalid TIFF compression");
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff) || !Number.isSafeInteger(width * height * 4)) throw new PdfError("E_LIMIT", "TIFF dimension limit exceeded");
  if (compression === "jpeg" && (width > 65535 || height > 65535)) throw new PdfError("E_LIMIT", "TIFF JPEG dimension limit exceeded");
  const chunkBytes = options.chunkBytes ?? 65536; const dpi = options.dpi ?? 72;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || !Number.isFinite(dpi)) throw new RangeError("Invalid TIFF encoding options");
  const stagingLimit = maximum(options.maxStagingBytes), outputLimit = maximum(options.maxOutputBytes), workingLimit = maximum(options.maxWorkingBytes);
  const headerLength = compression === "jpeg" ? 192 : 180;
  if (outputLimit < headerLength) throw new PdfError("E_LIMIT", "TIFF output byte limit exceeded");
  const scratch = compression === "jpeg" ? width * Math.min(8, height) * 4 + chunkBytes + 65536
    : compression === "packbits" ? width * 64 + chunkBytes * 2 + 1024
    : width * 6 + chunkBytes * 2 + (compression === "deflate" ? 1048576 : compression === "lzw" ? 524288 : 1024);
  if (!Number.isSafeInteger(scratch) || scratch + 256 > workingLimit) throw new PdfError("E_LIMIT", "TIFF working byte limit exceeded");
  const { signal } = options; signal?.throwIfAborted(); let strip: PdfFileSource | undefined; let failed = false;
  try {
    strip = await PdfFileSource.fromStream(storage.fs, storage.directory,
      encodeTiffStripChunks(width, height, input, compression, chunkBytes, signal),
      { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: Math.min(stagingLimit, outputLimit - headerLength, 0xffffffff - headerLength), ...(signal ? { signal } : {}) });
    const header = createTiffHeader(width, height, dpi, tags[compression], strip.size);
    for (let at = 0; at < header.length; at += chunkBytes) { signal?.throwIfAborted(); yield header.slice(at, at + chunkBytes); }
    yield* strip.stream(0, strip.size, signal);
  } catch (error) { failed = true; throw error; }
  finally { try { await strip?.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
}
