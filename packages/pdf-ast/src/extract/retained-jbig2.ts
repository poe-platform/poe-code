import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { Jbig2Image } from "../vendor/pdfjs-image-decoders.mjs";

export interface PdfRetainedJbig2Options {
  readonly globals?: PdfFileSource | undefined;
  /** Conservative fixed input-cache and cumulative decoder state, plus one RGBA
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
/** JBIG2 reads encoded input through fixed caches and retains admitted symbol/region decoder state and packed
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
    const inputs = [source, ...(options.globals ? [options.globals] : [])].map(input => {
      if (!Number.isSafeInteger(input.size) || input.size < 0 || !Number.isSafeInteger(input.chunkBytes) || input.chunkBytes < 1)
        throw new RangeError("Invalid JBIG2 source range");
      const chunkBytes = Math.min(4096, input.chunkBytes, input.size);
      charge(chunkBytes * 3 + 256);
      return {input, chunkBytes, data: {length: input.size}, bytes: new Uint8Array(), start: -1};
    });
    async function read(index: number, position: number): Promise<number | undefined> {
      options.signal?.throwIfAborted();
      const cache = inputs[index]!;
      if (position < 0 || position >= cache.input.size) return undefined;
      if (position < cache.start || position >= cache.start + cache.bytes.length) {
        const length = Math.min(cache.chunkBytes, cache.input.size - position);
        const bytes = await cache.input.read(position, length, options.signal);
        options.signal?.throwIfAborted();
        if (bytes.length !== length) throw new PdfError("E_PARSE", "Incomplete JBIG2 source range");
        cache.bytes = bytes.slice(); cache.start = position;
      }
      return cache.bytes[position - cache.start];
    }
    if (source.size < 11) throw new PdfError("E_PARSE", "Invalid JBIG2 stream");
    let standalone = true;
    const signature = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < signature.length; i++) if (await read(0, i) !== signature[i]) {standalone = false; break;}
    const decoder = new Jbig2Image(dimensions, charge);
    const chunks = options.globals ? [{data: inputs[1]!.data, start: 0, end: inputs[1]!.data.length}] : [];
    chunks.push({data: inputs[0]!.data, start: 0, end: source.size});
    const program = standalone ? decoder.parseSteps(inputs[0]!.data, {packed: true}) : decoder.parseChunksSteps(chunks);
    let step = program.next(), requests = 0;
    try {
      while (!step.done) {
        options.signal?.throwIfAborted();
        if (++requests % 4096 === 0) {await new Promise<void>(resolve => setTimeout(resolve, 0)); options.signal?.throwIfAborted();}
        const request = step.value;
        const index = inputs.findIndex(input => input.data === request.source);
        if (index < 0) throw new PdfError("E_PARSE", "Unknown JBIG2 source");
        step = program.next(await read(index, request.position));
      }
    } finally {program.return(undefined as never);}
    const pixels = step.value;
    const width = standalone ? decoder.width : fallbackWidth, height = standalone ? decoder.height : fallbackHeight;
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
