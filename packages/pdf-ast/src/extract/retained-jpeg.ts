import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { JpegImage } from "../vendor/pdfjs-image-decoders.mjs";
import type { JpegDecodeOptions } from "./images.js";

export interface PdfRetainedJpegOptions extends JpegDecodeOptions {
  /** Conservative encoded-input and decoder allocation admission, plus one
   * output row. The caller-owned source cache is additional memory. */
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
/** JPEG retains its admitted encoded input and DCT decoder state, but converts
 * pixels one row at a time. The source stays caller-owned and may close after
 * open() completes. close() releases the owner's decoder references. */
export class PdfRetainedJpeg {
  private constructor(private readRow: ((y: number) => Uint8Array) | undefined,
    readonly width: number, readonly height: number, readonly components: number,
    /** Conservative admitted parse allocation, before output row scratch. */
    readonly decoderBytes: number, private readonly signal?: AbortSignal) {}

  static async open(source: PdfFileSource, options: PdfRetainedJpegOptions = {}): Promise<PdfRetainedJpeg> {
    const maximum = limit(options.maxWorkingBytes, "maxWorkingBytes");
    const outputMaximum = limit(options.maxOutputBytes, "maxOutputBytes");
    let allocated = 0;
    let parsing = true;
    function charge(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum - allocated) throw new PdfError("E_LIMIT", "JPEG working byte limit exceeded");
      if (parsing) options.onDecoderAllocation?.(bytes);
      allocated += bytes;
    }
    options.signal?.throwIfAborted(); charge(source.size);
    charge(Math.min(source.size, source.chunkBytes));
    const bytes = new Uint8Array(source.size); let offset = 0;
    for await (const chunk of source.stream(0, source.size, options.signal)) { bytes.set(chunk, offset); offset += chunk.length; }
    let decodeTransform: Int32Array | undefined;
    if (options.decode) {
      charge(options.decode.length * 8); decodeTransform = new Int32Array(options.decode.length * 2);
      for (let i = 0; i < options.decode.length; i++) {
        const [low, high] = options.decode[i]!; decodeTransform[i * 2] = (high - low) * 256; decodeTransform[i * 2 + 1] = low * 255;
      }
    }
    const decoder = new JpegImage({ colorTransform: options.colorTransform, decodeTransform, onAllocation: charge,
      onImageDimensions(width, height) {
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new PdfError("E_PARSE", "Invalid JPEG dimensions");
        if (!Number.isSafeInteger(width * height) || width * height > Math.floor(outputMaximum / 4)) throw new PdfError("E_LIMIT", "JPEG output byte limit exceeded");
      },
    });
    let start = 0;
    while (start + 1 < bytes.length && !(bytes[start] === 255 && bytes[start + 1] === 216)) {
      if (start > 0 && start % 65536 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); options.signal?.throwIfAborted(); }
      start++;
    }
    options.signal?.throwIfAborted(); decoder.parse(bytes.subarray(start));
    const { width, height, numComponents: components } = decoder;
    if (![1, 3, 4].includes(components)) throw new PdfError("E_CAPABILITY", "Unsupported JPEG component count");
    const base = allocated; parsing = false;
    function readRow(y: number) {
      allocated = base;
      const rgb = decoder.getData({ width, height, forceRGB: true, isSourcePDF: options.isSourcePdf ?? false, rowStart: y, rowCount: 1 });
      if (rgb.length !== width * 3) throw new PdfError("E_PARSE", "Invalid JPEG row sample count");
      charge(width * 4);
      const row = new Uint8Array(width * 4);
      for (let x = 0; x < width; x++) { row[x * 4] = rgb[x * 3]!; row[x * 4 + 1] = rgb[x * 3 + 1]!; row[x * 4 + 2] = rgb[x * 3 + 2]!; row[x * 4 + 3] = 255; }
      return row;
    }
    return new PdfRetainedJpeg(readRow, width, height, components, base, options.signal);
  }

  async *rows(): AsyncGenerator<Uint8Array, void, void> {
    for (let y = 0; y < this.height; y++) {
      this.signal?.throwIfAborted();
      if (!this.readRow) throw new PdfError("E_CAPABILITY", "Retained JPEG decoder is closed");
      yield this.readRow(y);
    }
  }
  close(): void { this.readRow = undefined; }
}
