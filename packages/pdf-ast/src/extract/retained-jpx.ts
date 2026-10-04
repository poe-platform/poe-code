import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { JpxImage } from "../vendor/pdfjs-image-decoders.mjs";
import { decodeSamplesToRgbaAsync, type ResolvedColorSpace } from "./images.js";

export interface PdfRetainedJpxOptions {
  /** Conservative cumulative encoded/decoder admission plus one sample and RGBA
   * row. Caller source caches and resolved color state are additional memory. */
  readonly maxWorkingBytes?: number;
  /** Admit intrinsic encoded/decoder allocations to a containing owner before
   * allocation. Row scratch is separate; the owner releases admitted state. */
  readonly onDecoderAllocation?: (bytes: number) => void;
  readonly maxOutputBytes?: number;
  readonly color?: ResolvedColorSpace;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
/** Admits intrinsic JPEG 2000 input, tile and wavelet state. Pixels are assembled
 * and converted one row at a time; no duplicate full sample/RGBA plane is made.
 * The source stays caller-owned and can close after open(). */
export class PdfRetainedJpx {
  private constructor(private tiles: JpxImage["tiles"] | undefined,
    readonly width: number, readonly height: number, readonly components: number,
    /** Conservative cumulative parse allocations, not a measured heap size. */
    readonly decoderBytes: number, private readonly maximum: number,
    private readonly color: ResolvedColorSpace, private readonly signal?: AbortSignal) {}

  static async open(source: PdfFileSource, options: PdfRetainedJpxOptions = {}): Promise<PdfRetainedJpx> {
    const maximum = limit(options.maxWorkingBytes, "maxWorkingBytes");
    const outputMaximum = limit(options.maxOutputBytes, "maxOutputBytes");
    let allocated = 0;
    function charge(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum - allocated) throw new PdfError("E_LIMIT", "JPEG 2000 working byte limit exceeded");
      options.onDecoderAllocation?.(bytes);
      allocated += bytes;
    }
    function dimensions(width: number, height: number) {
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new PdfError("E_PARSE", "Invalid JPEG 2000 dimensions");
      if (!Number.isSafeInteger(width * height) || width * height > Math.floor(outputMaximum / 4)) throw new PdfError("E_LIMIT", "JPEG 2000 output byte limit exceeded");
    }
    options.signal?.throwIfAborted(); charge(source.size);
    // Reserve the live input range copy as well as the owned encoded payload.
    charge(Math.min(source.size, source.chunkBytes));
    const bytes = new Uint8Array(source.size); let offset = 0;
    for await (const chunk of source.stream(0, source.size, options.signal)) { bytes.set(chunk, offset); offset += chunk.length; }
    const decoder = new JpxImage(dimensions, charge); decoder.failOnCorruptedImage = true;
    options.signal?.throwIfAborted(); decoder.parse(bytes);
    const { width, height, componentsCount: components, tiles } = decoder; dimensions(width, height);
    if (!Number.isSafeInteger(components) || components <= 0 || !tiles?.length) throw new PdfError("E_PARSE", "JPEG 2000 stream has no valid image");
    if (!options.color && ![1, 3, 4].includes(components)) throw new PdfError("E_CAPABILITY", "Unsupported JPEG 2000 component count");
    const color = options.color ?? { colorSpace: components === 1 ? "gray" : components === 4 ? "cmyk" : "rgb", components };
    if (color.components !== components) throw new PdfError("E_PARSE", "JPEG 2000 color component mismatch");
    for (const tile of tiles) {
      if (![tile.left, tile.top, tile.width, tile.height].every(Number.isSafeInteger) || tile.left < 0 || tile.top < 0 || tile.width < 0 || tile.height < 0 ||
          tile.left + tile.width > width || tile.top + tile.height > height || tile.items.length !== tile.width * tile.height * components) throw new PdfError("E_PARSE", "Invalid JPEG 2000 tile bounds");
    }
    return new PdfRetainedJpx(tiles, width, height, components, allocated, maximum, color, options.signal);
  }

  async *rows(): AsyncGenerator<Uint8Array, void, void> {
    const scratch = this.width * (this.components + 4) + (this.color.isDeviceN || this.color.isSeparation ? this.components * 8 : 0);
    for (let y = 0; y < this.height; y++) {
      this.signal?.throwIfAborted();
      if (!this.tiles) throw new PdfError("E_CAPABILITY", "Retained JPEG 2000 decoder is closed");
      if (!Number.isSafeInteger(scratch) || scratch > this.maximum - this.decoderBytes) throw new PdfError("E_LIMIT", "JPEG 2000 row working byte limit exceeded");
      const samples = new Uint8Array(this.width * this.components);
      for (const tile of this.tiles) {
        if (y < tile.top || y >= tile.top + tile.height) continue;
        const start = (y - tile.top) * tile.width * this.components;
        samples.set(tile.items.subarray(start, start + tile.width * this.components), tile.left * this.components);
      }
      yield await decodeSamplesToRgbaAsync([samples, this.width, 1, 8, this.color], this.signal);
    }
  }
  close(): void { this.tiles = undefined; }
}
