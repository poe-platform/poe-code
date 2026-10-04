import type { PdfPixelStorage } from "../ast.js";
import type { Jbig2StoredBitmap } from "../vendor/pdfjs-image-decoders.mjs";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { Jbig2Image } from "../vendor/pdfjs-image-decoders.mjs";

export interface PdfRetainedJbig2Options {
  /** Caller-owned packed page and text-region backing. Symbol/pattern state is admitted separately. */
  readonly bitmapStorage?: PdfPixelStorage;
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
 * page pixels, optionally in caller backing with fixed scratch. Only one output row is expanded. Both sources stay caller-owned
 * and may close after open(); close() releases decoder references and cancels pending row reads. */
export class PdfRetainedJbig2 {
  private constructor(private pixels: Uint8Array | Uint8ClampedArray | Jbig2StoredBitmap | undefined,
    readonly width: number, readonly height: number,
    /** Conservative admitted parse allocation, not measured heap. */
    readonly decoderBytes: number, private readonly maximum: number,
    private readonly controller: AbortController, private readonly signal?: AbortSignal, private readonly storage?: PdfPixelStorage) {}

  static async open(source: PdfFileSource, fallbackWidth: number, fallbackHeight: number,
    options: PdfRetainedJbig2Options = {}): Promise<PdfRetainedJbig2> {
    const controller = new AbortController();
    options = {...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal};
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
    if (options.bitmapStorage) charge(4096 * 4 + 1024);
    const decoder = new Jbig2Image(dimensions, charge, {storedBitmap: options.bitmapStorage !== undefined});
    const pages: {position: number; bytes: Uint8Array; dirty: boolean}[] = [];
    const selected = options.signal ? {signal: options.signal} : undefined;
    async function flush(selectedPages = pages) {
      for (const page of selectedPages) if (page.dirty) {await options.bitmapStorage!.write(page.position, page.bytes, selected); page.dirty = false;}
    }
    const chunks = options.globals ? [{data: inputs[1]!.data, start: 0, end: inputs[1]!.data.length}] : [];
    chunks.push({data: inputs[0]!.data, start: 0, end: source.size});
    const program = standalone ? decoder.parseSteps(inputs[0]!.data, {packed: true}) : decoder.parseChunksSteps(chunks);
    let step = program.next(), requests = 0;
    try {
      while (!step.done) {
        options.signal?.throwIfAborted();
        if (++requests % 4096 === 0) {await new Promise<void>(resolve => setTimeout(resolve, 0)); options.signal?.throwIfAborted();}
        const request = step.value;
        if ("kind" in request) {
          const storage = options.bitmapStorage!;
          if (request.kind === "bitmap-allocate") {
            await flush(); pages.length = 0;
            const {length, fill} = request;
            if (!Number.isSafeInteger(length) || length < 0) throw new PdfError("E_LIMIT", "Invalid JBIG2 bitmap size");
            const position = storage.allocate(length);
            if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(position + length)) throw new PdfError("E_LIMIT", "Invalid JBIG2 bitmap allocation");
            const bytes = new Uint8Array(Math.min(4096, length)).fill(fill);
            for (let at = 0; at < length; at += bytes.length) {
              options.signal?.throwIfAborted();
              await storage.write(position + at, bytes.subarray(0, Math.min(bytes.length, length - at)), selected);
              if (at % 65536 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            step = program.next(position);
          } else {
            const {bitmap, offset} = request;
            let value: number | undefined;
            if (Number.isInteger(offset) && offset >= 0 && offset < bitmap.length) {
              const start = Math.floor(offset / 4096) * 4096, position = bitmap.position + start;
              const index = pages.findIndex(page => page.position === position);
              let page = index >= 0 ? pages.splice(index, 1)[0] : undefined;
              if (!page) {
                if (pages.length === 2) await flush([pages.shift()!]);
                const length = Math.min(4096, bitmap.length - start), bytes = await storage.read(position, length, selected);
                options.signal?.throwIfAborted();
                if (bytes.length !== length) throw new PdfError("E_PARSE", "Incomplete JBIG2 bitmap read");
                page = {position, bytes: bytes.slice(), dirty: false};
              }
              pages.push(page);
              const at = offset - start;
              value = page.bytes[at];
              if (request.kind === "bitmap-update") {
                page.bytes[at] = request.operator === "or" ? value! | request.mask : value! ^ request.mask;
                page.dirty = true;
              }
            }
            step = program.next(value);
          }
          continue;
        }
        const index = inputs.findIndex(input => input.data === request.source);
        if (index < 0) throw new PdfError("E_PARSE", "Unknown JBIG2 source");
        step = program.next(await read(index, request.position));
      }
      await flush();
      options.signal?.throwIfAborted();
    } finally {program.return(undefined as never);}
    const pixels = step.value;
    const width = standalone ? decoder.width : fallbackWidth, height = standalone ? decoder.height : fallbackHeight;
    dimensions(width, height);
    if (!pixels || width <= 0 || height <= 0 || pixels.length !== Math.ceil(width / 8) * height) throw new PdfError("E_PARSE", "JBIG2 bitmap dimensions do not match decoded data");
    return new PdfRetainedJbig2(pixels, width, height, allocated, maximum, controller, options.signal, options.bitmapStorage);
  }

  async *rows(): AsyncGenerator<Uint8Array, void, void> {
    let cached = new Uint8Array(), start = -1;
    for (let y = 0; y < this.height; y++) {
      this.signal?.throwIfAborted();
      if (!this.pixels) throw new PdfError("E_CAPABILITY", "Retained JBIG2 decoder is closed");
      if (this.width * 4 > this.maximum - this.decoderBytes) throw new PdfError("E_LIMIT", "JBIG2 row working byte limit exceeded");
      const row = new Uint8Array(this.width * 4);
      for (let x = 0; x < this.width; x++) {
        const offset = y * Math.ceil(this.width / 8) + (x >> 3);
        let byte: number;
        if ("position" in this.pixels) {
          if (offset < start || offset >= start + cached.length) {
            const length = Math.min(4096, this.pixels.length - offset);
            const bytes = await this.storage!.read(this.pixels.position + offset, length, this.signal ? {signal: this.signal} : undefined);
            this.signal?.throwIfAborted();
            if (!this.pixels) throw new PdfError("E_CAPABILITY", "Retained JBIG2 decoder is closed");
            if (bytes.length !== length) throw new PdfError("E_PARSE", "Incomplete JBIG2 bitmap row");
            cached = bytes.slice(); start = offset;
          }
          byte = cached[offset - start]!;
        } else byte = this.pixels[offset]!;
        const lum = (byte >> (7 - (x & 7))) & 1 ? 0 : 255;
        row[x * 4] = lum; row[x * 4 + 1] = lum; row[x * 4 + 2] = lum; row[x * 4 + 3] = 255;
      }
      yield row;
    }
  }
  close(): void { this.pixels = undefined; this.controller.abort(new PdfError("E_CAPABILITY", "Retained JBIG2 decoder is closed")); }
}
