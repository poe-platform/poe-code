import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { Jbig2Image } from "../vendor/pdfjs-image-decoders.mjs";

export interface PdfRetainedJbig2Options {
  readonly globals?: PdfFileSource | undefined;
  /** Conservative cumulative encoded input and decoder state, plus one RGBA
   * row. Caller-owned source caches are additional memory. */
  readonly maxWorkingBytes?: number;
  /** Admit intrinsic encoded/decoder allocations to a containing owner before
   * allocation. Row scratch is separate; the owner releases admitted state. */
  readonly onDecoderAllocation?: (bytes: number) => void;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
/** JBIG2 retains admitted encoded input, symbol/region decoder state and packed
 * page pixels. Only one output row is expanded. Both sources stay caller-owned
 * and may close after open(); close() releases the owner's packed bitmap. */
export class PdfRetainedJbig2 {
  private constructor(private pixels: Uint8Array | Uint8ClampedArray | undefined,
    readonly width: number, readonly height: number,
    /** Conservative admitted parse allocation, not measured heap. */
    readonly decoderBytes: number, private readonly maximum: number,
    private readonly signal?: AbortSignal) {}

  static async open(source: PdfFileSource, fallbackWidth: number, fallbackHeight: number,
    options: PdfRetainedJbig2Options = {}): Promise<PdfRetainedJbig2> {
    const maximum = limit(options.maxWorkingBytes, "maxWorkingBytes");
    const outputMaximum = limit(options.maxOutputBytes, "maxOutputBytes");
    let allocated = 0;
    function charge(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum - allocated) throw new PdfError("E_LIMIT", "JBIG2 working byte limit exceeded");
      options.onDecoderAllocation?.(bytes);
      allocated += bytes;
    }
    function dimensions(width: number, height: number) {
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) throw new PdfError("E_PARSE", "Invalid JBIG2 dimensions");
      if (!Number.isSafeInteger(width * height) || width * height > Math.floor(outputMaximum / 4)) throw new PdfError("E_LIMIT", "JBIG2 output byte limit exceeded");
    }
    options.signal?.throwIfAborted(); dimensions(fallbackWidth, fallbackHeight);
    charge(source.size); charge(options.globals?.size ?? 0);
    charge(Math.max(Math.min(source.size, source.chunkBytes), options.globals ? Math.min(options.globals.size, options.globals.chunkBytes) : 0));
    async function read(input: PdfFileSource) {
      const bytes = new Uint8Array(input.size); let offset = 0;
      for await (const chunk of input.stream(0, input.size, options.signal)) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    }
    const bytes = await read(source);
    if (bytes.length < 11) throw new PdfError("E_PARSE", "Invalid JBIG2 stream");
    const decoder = new Jbig2Image(dimensions, charge);
    let pixels: Uint8Array | Uint8ClampedArray | undefined;
    let width = fallbackWidth, height = fallbackHeight;
    const standalone = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
    if (standalone) {
      options.signal?.throwIfAborted(); pixels = decoder.parse(bytes, { packed: true }); width = decoder.width; height = decoder.height;
    } else {
      const globals = options.globals ? await read(options.globals) : undefined;
      const chunks = globals ? [{ data: globals, start: 0, end: globals.length }] : [];
      chunks.push({ data: bytes, start: 0, end: bytes.length });
      options.signal?.throwIfAborted(); pixels = decoder.parseChunks(chunks);
    }
    dimensions(width, height);
    if (!pixels || width <= 0 || height <= 0 || pixels.length !== Math.ceil(width / 8) * height) throw new PdfError("E_PARSE", "JBIG2 bitmap dimensions do not match decoded data");
    return new PdfRetainedJbig2(pixels, width, height, allocated, maximum, options.signal);
  }

  async *rows(): AsyncGenerator<Uint8Array, void, void> {
    for (let y = 0; y < this.height; y++) {
      this.signal?.throwIfAborted();
      if (!this.pixels) throw new PdfError("E_CAPABILITY", "Retained JBIG2 decoder is closed");
      if (this.width * 4 > this.maximum - this.decoderBytes) throw new PdfError("E_LIMIT", "JBIG2 row working byte limit exceeded");
      const row = new Uint8Array(this.width * 4);
      for (let x = 0; x < this.width; x++) {
        const lum = (this.pixels[y * Math.ceil(this.width / 8) + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 0 : 255;
        row[x * 4] = lum; row[x * 4 + 1] = lum; row[x * 4 + 2] = lum; row[x * 4 + 3] = 255;
      }
      yield row;
    }
  }
  close(): void { this.pixels = undefined; }
}
