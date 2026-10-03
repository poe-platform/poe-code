import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { drainWorkAsync } from "../work.js";
import { decodeSamplesToRgbaSteps, type ResolvedColorSpace } from "./images.js";

export interface PdfSampleRowOptions {
  /** Bounds owned sample/alpha rows, the RGBA row, tint-channel scratch, and one temporary range read.
   * Caller-owned source caches and color-space state are additional memory. */
  readonly maxWorkingBytes?: number;
  readonly maxOutputBytes?: number;
  readonly alpha?: PdfFileSource;
  readonly decode?: ReadonlyArray<readonly [number, number]>;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
/** Convert retained decoded samples to owned RGBA rows. Sources stay caller-owned.
 * Known input lengths preserve the buffered decoder's whole-image truncation
 * rules without collecting the sample plane or output bitmap. */
export async function* decodeRetainedSampleRows(source: PdfFileSource, width: number, height: number, bitsPerComponent: number,
  color: ResolvedColorSpace, options: PdfSampleRowOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  for (const [name, value] of [["width", width], ["height", height], ["bitsPerComponent", bitsPerComponent], ["components", color.components]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid ${name}`);
  }
  const workingLimit = limit(options.maxWorkingBytes, "maxWorkingBytes");
  const outputLimit = limit(options.maxOutputBytes, "maxOutputBytes");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > Math.floor(outputLimit / 4)) throw new PdfError("E_LIMIT", "PDF sample output byte limit exceeded");
  options.signal?.throwIfAborted();
  let bpc = bitsPerComponent;
  let rowBytes: number;
  if (color.isSeparation || color.isDeviceN) rowBytes = width * Math.max(1, color.components) * (bpc === 16 ? 2 : 1);
  else if (color.calibrated?.name === "Lab") rowBytes = width * 3 * (bpc === 16 ? 2 : 1);
  else if (color.colorSpace === "rgb") {
    if (bpc === 16 && source.size >= pixels * 6) rowBytes = width * 6;
    else if (source.size >= pixels * 3) { bpc = 8; rowBytes = width * 3; }
    else rowBytes = 0;
  } else if (color.colorSpace === "gray") {
    if (bpc === 16 && source.size >= pixels * 2) rowBytes = width * 2;
    else if (bpc === 1 || bpc === 2 || bpc === 4) rowBytes = Math.ceil(width * bpc / 8);
    else { bpc = 8; rowBytes = width; }
  } else if (color.colorSpace === "cmyk") rowBytes = width * (bpc === 16 ? 8 : 4);
  else rowBytes = Math.max(1, Math.ceil(width * bpc / 8));
  const alpha = options.alpha && options.alpha.size >= pixels ? options.alpha : undefined;
  const sampleBytes = Math.min(source.size, rowBytes);
  const alphaBytes = alpha ? width : 0;
  const rangeBytes = Math.max(Math.min(source.chunkBytes, sampleBytes), alpha ? Math.min(alpha.chunkBytes, alphaBytes) : 0);
  const channelBytes = color.isSeparation || color.isDeviceN ? color.components * 8 : 0;
  const workingBytes = sampleBytes + alphaBytes + width * 4 + rangeBytes + channelBytes;
  if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(workingBytes) || workingBytes > workingLimit) throw new PdfError("E_LIMIT", "PDF sample working byte limit exceeded");
  async function row(input: PdfFileSource, start: number, length: number): Promise<Uint8Array> {
    const actual = Math.max(0, Math.min(length, input.size - start));
    const bytes = new Uint8Array(actual);
    for (let offset = 0; offset < actual; offset += input.chunkBytes) {
      options.signal?.throwIfAborted();
      bytes.set(await input.read(start + offset, Math.min(input.chunkBytes, actual - offset), options.signal), offset);
    }
    return bytes;
  }
  for (let y = 0; y < height; y++) {
    options.signal?.throwIfAborted();
    const samples = await row(source, y * rowBytes, rowBytes);
    const alphaRow = alpha ? await row(alpha, y * width, width) : undefined;
    yield await drainWorkAsync(decodeSamplesToRgbaSteps(samples, width, 1, bpc, color, alphaRow, options.decode), options.signal);
  }
}
