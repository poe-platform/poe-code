import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { applyImageMaskPixel } from "./mask-pixel.js";

export interface PdfRetainedImageMask { readonly source: PdfFileSource; readonly width: number; readonly height: number }
export interface PdfImageMaskOptions {
  readonly mode: "soft" | "explicit";
  readonly matte?: readonly [number, number, number];
  /** Input/output rows, one mask row, and one temporary range read. The
   * caller-owned mask source cache is additional memory. */
  readonly maxWorkingBytes?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
/** Apply a retained RGBA mask to exact RGBA input rows under consumer
 * backpressure. Output rows are owned; the mask source remains caller-owned. */
export async function* applyRetainedImageMask(rows: AsyncIterable<Uint8Array>, width: number, height: number,
  mask: PdfRetainedImageMask, options: PdfImageMaskOptions): AsyncGenerator<Uint8Array, void, void> {
  for (const [name, value] of [["width", width], ["height", height], ["mask.width", mask.width], ["mask.height", mask.height]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid ${name}`);
  }
  if (options.mode !== "soft" && options.mode !== "explicit") throw new RangeError("Invalid mask mode");
  const workingLimit = limit(options.maxWorkingBytes, "maxWorkingBytes");
  const outputLimit = limit(options.maxOutputBytes, "maxOutputBytes");
  const pixels = width * height; const maskPixels = mask.width * mask.height;
  if (!Number.isSafeInteger(pixels) || pixels > Math.floor(outputLimit / 4)) throw new PdfError("E_LIMIT", "PDF masked output byte limit exceeded");
  if (!Number.isSafeInteger(maskPixels) || maskPixels > Math.floor(Number.MAX_SAFE_INTEGER / 4)) throw new PdfError("E_LIMIT", "PDF mask size limit exceeded");
  if (mask.source.size < maskPixels * 4) throw new PdfError("E_PARSE", "Truncated retained RGBA mask");
  const rowBytes = width * 4; const maskRowBytes = mask.width * 4;
  const workingBytes = rowBytes * 2 + maskRowBytes + Math.min(mask.source.chunkBytes, maskRowBytes);
  if (!Number.isSafeInteger(workingBytes) || workingBytes > workingLimit) throw new PdfError("E_LIMIT", "PDF mask working byte limit exceeded");
  options.signal?.throwIfAborted();
  let maskRow: Uint8Array | undefined; let maskY = -1; let y = 0;
  for await (const input of readBytes(rows, options.signal)) {
    if (y >= height || input.length !== rowBytes) throw new PdfError("E_PARSE", "Invalid RGBA input row");
    const sourceY = Math.min(mask.height - 1, Math.floor(y * mask.height / height));
    if (sourceY !== maskY) {
      maskRow = undefined;
      const bytes = new Uint8Array(maskRowBytes);
      for (let at = 0; at < bytes.length; at += mask.source.chunkBytes) {
        bytes.set(await mask.source.read(sourceY * maskRowBytes + at, Math.min(mask.source.chunkBytes, bytes.length - at), options.signal), at);
      }
      maskRow = bytes; maskY = sourceY;
    }
    const output = input.slice();
    for (let x = 0; x < width; x++) {
      if (x > 0 && x % 16384 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); options.signal?.throwIfAborted(); }
      const sourceX = Math.min(mask.width - 1, Math.floor(x * mask.width / width));
      applyImageMaskPixel(output, x * 4, maskRow![sourceX * 4]!, options.mode, options.matte);
    }
    y++; yield output;
  }
  if (y !== height) throw new PdfError("E_PARSE", "Truncated RGBA input rows");
}
