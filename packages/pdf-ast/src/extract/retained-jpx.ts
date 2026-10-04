import type { PdfPixelStorage } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { JpxImage } from "../vendor/pdfjs-image-decoders.mjs";
import { decodeSamplesToRgbaAsync, type ResolvedColorSpace } from "./images.js";

export interface PdfRetainedJpxOptions {
  /** Caller-owned coefficient, wavelet scratch, sample, precinct-tree, codeblock and packet-record backing. */
  readonly coefficientStorage?: PdfPixelStorage;
  /** Conservative cumulative input-cache/decoder admission plus one sample and RGBA
   * row. Caller source caches and resolved color state are additional memory. */
  readonly maxWorkingBytes?: number;
  /** Admit input-cache/decoder allocations to a containing owner before
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
/** Reads encoded JPEG 2000 ranges with a fixed cache; admits tile/wavelet state. Pixels are assembled
 * and converted one row at a time; no duplicate full sample/RGBA plane is made.
 * The source stays caller-owned and can close after open(). */
export class PdfRetainedJpx {
  private constructor(
    private tiles: (JpxImage["tiles"][number] | JpxImage["storedTiles"][number])[] | undefined,
    readonly width: number,
    readonly height: number,
    readonly components: number,
    /** Conservative cumulative parse allocations, not a measured heap size. */
    readonly decoderBytes: number,
    private readonly maximum: number,
    private readonly color: ResolvedColorSpace,
    private readonly controller: AbortController,
    private readonly signal?: AbortSignal,
    private readonly storage?: PdfPixelStorage
  ) {}

  static async open(
    source: PdfFileSource,
    options: PdfRetainedJpxOptions = {}
  ): Promise<PdfRetainedJpx> {
    const controller = new AbortController();
    options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal
    };
    const maximum = limit(options.maxWorkingBytes, "maxWorkingBytes");
    const outputMaximum = limit(options.maxOutputBytes, "maxOutputBytes");
    let allocated = 0;
    let allocationFailure: { reason: unknown } | undefined;
    function charge(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum - allocated)
        throw new PdfError("E_LIMIT", "JPEG 2000 working byte limit exceeded");
      try {
        options.onDecoderAllocation?.(bytes);
      } catch (reason) {
        allocationFailure = { reason };
        throw reason;
      }
      allocated += bytes;
    }
    function dimensions(width: number, height: number) {
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0
      )
        throw new PdfError("E_PARSE", "Invalid JPEG 2000 dimensions");
      if (!Number.isSafeInteger(width * height) || width * height > Math.floor(outputMaximum / 4))
        throw new PdfError("E_LIMIT", "JPEG 2000 output byte limit exceeded");
    }
    options.signal?.throwIfAborted();
    const chunkBytes = Math.min(source.size, source.chunkBytes);
    if (
      !Number.isSafeInteger(source.size) ||
      source.size < 0 ||
      !Number.isSafeInteger(source.chunkBytes) ||
      source.chunkBytes < 1
    )
      throw new RangeError("Invalid JPEG 2000 source range");
    // Old cache, backend response, detached replacement and one packet range.
    charge(chunkBytes * 3 + Math.min(4096, source.size));
    let cache = new Uint8Array(),
      cacheStart = -1;
    async function refill(position: number) {
      options.signal?.throwIfAborted();
      const length = Math.min(chunkBytes, source.size - position),
        bytes = await source.read(position, length, options.signal);
      options.signal?.throwIfAborted();
      if (bytes.length !== length)
        throw new PdfError("E_PARSE", "Incomplete JPEG 2000 source range");
      cache = bytes.slice();
      cacheStart = position;
    }
    if (options.coefficientStorage) charge(4096 * 14 + 2048);
    const clamped = new Uint8ClampedArray(1);
    // Five bit-model arrays can each span the current and neighboring page.
    // Two spare pages cover coefficient/output windows without backend thrashing.
    const pages: {
      position: number;
      bytes: Uint8Array;
      view: DataView;
      dirty: boolean;
      used: number;
    }[] = [];
    const selected = options.signal ? { signal: options.signal } : undefined;
    async function loadPage(position: number, length: number, used: number) {
      const storage = options.coefficientStorage!;
      if (pages.length === 12) {
        let oldest = 0;
        for (let i = 1; i < pages.length; i++) if (pages[i]!.used < pages[oldest]!.used) oldest = i;
        const page = pages.splice(oldest, 1)[0]!;
        if (page.dirty) await storage.write(page.position, page.bytes, selected);
      }
      const borrowed = await storage.read(position, length, selected);
      if (borrowed.length !== length)
        throw new PdfError("E_PARSE", "Incomplete JPEG 2000 plane read");
      const bytes = borrowed.slice(),
        page = { position, bytes, view: new DataView(bytes.buffer), dirty: false, used };
      pages.push(page);
      return page;
    }
    const decoder = new JpxImage(dimensions, charge, {
      storedPlanes: options.coefficientStorage !== undefined
    });
    decoder.failOnCorruptedImage = true;
    const program = decoder.parseSteps({ length: source.size });
    let step = program.next(),
      requests = 0;
    try {
      while (!step.done) {
        options.signal?.throwIfAborted();
        if (++requests % 4096 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          options.signal?.throwIfAborted();
        }
        const request = step.value;
        if (typeof request === "number") {
          if (request < 0 || request >= source.size) step = program.next(undefined);
          else {
            if (request < cacheStart || request >= cacheStart + cache.length) await refill(request);
            step = program.next(cache[request - cacheStart]);
          }
        } else if ("kind" in request) {
          const storage = options.coefficientStorage;
          if (!storage) throw new PdfError("E_CAPABILITY", "JPEG 2000 plane storage is required");
          const selected = options.signal ? { signal: options.signal } : undefined;
          if (request.kind === "vector-allocate") {
            if (!Number.isSafeInteger(request.length) || request.length < 0)
              throw new PdfError("E_LIMIT", "Invalid JPEG 2000 plane size");
            const position = storage.allocate(request.length),
              zeros = new Uint8Array(Math.min(4096, request.length));
            if (
              !Number.isSafeInteger(position) ||
              position < 0 ||
              !Number.isSafeInteger(position + request.length)
            )
              throw new PdfError("E_LIMIT", "Invalid JPEG 2000 plane allocation");
            for (let at = 0; at < request.length; at += zeros.length) {
              options.signal?.throwIfAborted();
              await storage.write(
                position + at,
                zeros.subarray(0, Math.min(zeros.length, request.length - at)),
                selected
              );
              if (at % 65536 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            step = program.next(position);
          } else {
            const { vector, index } = request,
              offset = index * vector.bytesPerElement,
              pageOffset = Math.floor(offset / 4096) * 4096,
              position = vector.position + pageOffset;
            const page =
              pages.find((page) => page.position === position) ??
              (await loadPage(
                position,
                Math.min(4096, vector.length * vector.bytesPerElement - pageOffset),
                requests
              ));
            page.used = requests;
            const at = offset - pageOffset;
            if (request.kind === "vector-read")
              step = program.next(
                vector.bytesPerElement === 8
                  ? page.view.getFloat64(at, true)
                  : vector.bytesPerElement === 4
                    ? vector.integer
                      ? page.view.getUint32(at, true)
                      : page.view.getFloat32(at, true)
                    : vector.bytesPerElement === 2
                      ? page.view.getUint16(at, true)
                      : page.bytes[at]
              );
            else {
              if (vector.bytesPerElement === 8) page.view.setFloat64(at, request.value, true);
              else if (vector.bytesPerElement === 4 && vector.integer)
                page.view.setUint32(at, request.value, true);
              else if (vector.bytesPerElement === 2) page.view.setUint16(at, request.value, true);
              else if (vector.bytesPerElement === 4) page.view.setFloat32(at, request.value, true);
              else if (vector.integer) page.bytes[at] = request.value;
              else {
                clamped[0] = request.value;
                page.bytes[at] = clamped[0]!;
              }
              page.dirty = true;
              step = program.next();
            }
          }
        } else {
          const length = request.end - request.start;
          if (
            !Number.isSafeInteger(request.start) ||
            request.start < 0 ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > 4096 ||
            request.end > source.size
          )
            throw new PdfError("E_PARSE", "Invalid JPEG 2000 packet range");
          const bytes = new Uint8Array(length);
          let copied = 0;
          while (copied < length) {
            const at = request.start + copied;
            if (at < cacheStart || at >= cacheStart + cache.length) await refill(at);
            const take = Math.min(length - copied, cacheStart + cache.length - at);
            bytes.set(cache.subarray(at - cacheStart, at - cacheStart + take), copied);
            copied += take;
          }
          step = program.next(bytes);
        }
      }
      for (const page of pages)
        if (page.dirty)
          await options.coefficientStorage!.write(page.position, page.bytes, selected);
      options.signal?.throwIfAborted();
    } catch (error) {
      if (allocationFailure) throw allocationFailure.reason;
      throw error;
    } finally {
      program.return();
    }
    const { width, height, componentsCount: components } = decoder;
    const tiles = options.coefficientStorage ? decoder.storedTiles : decoder.tiles;
    dimensions(width, height);
    if (!Number.isSafeInteger(components) || components <= 0 || !tiles?.length)
      throw new PdfError("E_PARSE", "JPEG 2000 stream has no valid image");
    if (!options.color && ![1, 3, 4].includes(components))
      throw new PdfError("E_CAPABILITY", "Unsupported JPEG 2000 component count");
    const color = options.color ?? {
      colorSpace: components === 1 ? "gray" : components === 4 ? "cmyk" : "rgb",
      components
    };
    if (color.components !== components)
      throw new PdfError("E_PARSE", "JPEG 2000 color component mismatch");
    for (const tile of tiles) {
      if (
        ![tile.left, tile.top, tile.width, tile.height].every(Number.isSafeInteger) ||
        tile.left < 0 ||
        tile.top < 0 ||
        tile.width < 0 ||
        tile.height < 0 ||
        tile.left + tile.width > width ||
        tile.top + tile.height > height ||
        tile.items.length !== tile.width * tile.height * components
      )
        throw new PdfError("E_PARSE", "Invalid JPEG 2000 tile bounds");
    }
    return new PdfRetainedJpx(
      tiles,
      width,
      height,
      components,
      allocated,
      maximum,
      color,
      controller,
      options.signal,
      options.coefficientStorage
    );
  }

  async *rows(): AsyncGenerator<Uint8Array, void, void> {
    const scratch =
      this.width * (this.components + 4) +
      (this.color.isDeviceN || this.color.isSeparation ? this.components * 8 : 0);
    for (let y = 0; y < this.height; y++) {
      this.signal?.throwIfAborted();
      if (!this.tiles) throw new PdfError("E_CAPABILITY", "Retained JPEG 2000 decoder is closed");
      if (!Number.isSafeInteger(scratch) || scratch > this.maximum - this.decoderBytes)
        throw new PdfError("E_LIMIT", "JPEG 2000 row working byte limit exceeded");
      const samples = new Uint8Array(this.width * this.components);
      for (const tile of this.tiles) {
        if (y < tile.top || y >= tile.top + tile.height) continue;
        const start = (y - tile.top) * tile.width * this.components;
        if (tile.items instanceof Uint8ClampedArray) {
          samples.set(
            tile.items.subarray(start, start + tile.width * this.components),
            tile.left * this.components
          );
        } else {
          const length = tile.width * this.components;
          for (let at = 0; at < length; at += 4096) {
            this.signal?.throwIfAborted();
            const size = Math.min(4096, length - at),
              bytes = await this.storage!.read(
                tile.items.position + start + at,
                size,
                this.signal ? { signal: this.signal } : undefined
              );
            this.signal?.throwIfAborted();
            if (bytes.length !== size)
              throw new PdfError("E_PARSE", "Incomplete JPEG 2000 sample row");
            samples.set(bytes, tile.left * this.components + at);
          }
        }
      }
      const row = await decodeSamplesToRgbaAsync(
        [samples, this.width, 1, 8, this.color],
        this.signal
      );
      this.signal?.throwIfAborted();
      yield row;
    }
  }
  close(): void {
    this.tiles = undefined;
    this.controller.abort(new PdfError("E_CAPABILITY", "Retained JPEG 2000 decoder is closed"));
  }
}
