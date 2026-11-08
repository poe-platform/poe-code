import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";

export type PdfPortableBitmapFormat = "ppm" | "pgm" | "pbm";
export interface PdfPortableBitmapOptions {
  readonly chunkBytes?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

/** Shared incremental pixel conversion. Undefined steps provide cooperative
 * checkpoints even when packed monochrome output has not filled a chunk. */
export class PortableBitmapEncoder {
  readonly header: Uint8Array;
  readonly size: number;
  readonly chunkBytes: number;
  private readonly width: number;
  private readonly pixels: number;
  private inputBytes = 0;
  private pixelsWritten = 0;
  private r = 255; private g = 255; private b = 255;
  private packed = 0; private bits = 0;
  private buffer: Uint8Array;
  private used = 0;
  private readonly samples = new Uint8Array(3);
  private emitted = 0;
  private readonly payloadBytes: number;

  constructor(private readonly format: PdfPortableBitmapFormat, width: number, height: number, options: PdfPortableBitmapOptions = {}) {
    if (format !== "ppm" && format !== "pgm" && format !== "pbm") throw new RangeError("Invalid portable bitmap format");
    if (![width, height].every(Number.isSafeInteger)) throw new RangeError("Invalid portable bitmap dimensions");
    this.width = Math.max(1, width); height = Math.max(1, height);
    this.pixels = this.width * height;
    if (!Number.isSafeInteger(this.pixels * 4)) throw new PdfError("E_LIMIT", "Portable bitmap dimension limit exceeded");
    this.chunkBytes = options.chunkBytes ?? 65536;
    if (!Number.isSafeInteger(this.chunkBytes) || this.chunkBytes < 1) throw new RangeError("Invalid portable bitmap chunk size");
    const maximum = options.maxOutputBytes ?? Infinity;
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid portable bitmap output limit");
    this.payloadBytes = format === "ppm" ? this.pixels * 3 : format === "pgm" ? this.pixels : Math.ceil(this.width / 8) * height;
    this.header = new TextEncoder().encode(`${format === "ppm" ? "P6" : format === "pgm" ? "P5" : "P4"}\n${this.width} ${height}\n${format === "pbm" ? "" : "255\n"}`);
    this.size = this.header.length + this.payloadBytes;
    if (!Number.isSafeInteger(this.size) || this.size > maximum) throw new PdfError("E_LIMIT", "Portable bitmap output byte limit exceeded");
    this.buffer = new Uint8Array(Math.min(this.chunkBytes, this.payloadBytes));
  }

  get complete(): boolean { return this.pixelsWritten === this.pixels; }

  private byte(value: number): Uint8Array | undefined {
    this.buffer[this.used++] = value;
    if (this.used !== this.buffer.length) return undefined;
    const output = this.buffer; this.emitted += this.used; this.used = 0;
    this.buffer = new Uint8Array(Math.min(this.chunkBytes, this.payloadBytes - this.emitted));
    return output;
  }

  private pixel(): number {
    this.pixelsWritten++;
    let count = 0;
    if (this.format === "ppm") { this.samples[0] = this.r; this.samples[1] = this.g; this.samples[2] = this.b; count = 3; }
    else {
      const luminance = 0.299 * this.r + 0.587 * this.g + 0.114 * this.b;
      if (this.format === "pgm") { this.samples[0] = Math.round(luminance); count = 1; }
      else {
        if (luminance < 128) this.packed |= 1 << (7 - this.bits);
        this.bits++;
        if (this.bits === 8 || this.pixelsWritten % this.width === 0) {
          this.samples[0] = this.packed; count = 1; this.bits = 0; this.packed = 0;
        }
      }
    }
    this.r = this.g = this.b = 255;
    return count;
  }

  *push(bytes: Uint8Array): Generator<Uint8Array | undefined, void, void> {
    for (let at = 0; at < bytes.length && !this.complete; at++) {
      const channel = this.inputBytes++ % 4;
      if (channel === 0) this.r = bytes[at]!;
      else if (channel === 1) this.g = bytes[at]!;
      else if (channel === 2) this.b = bytes[at]!;
      else {
        const count = this.pixel();
        for (let i = 0; i < count; i++) { const output = this.byte(this.samples[i]!); if (output) yield output; }
      }
      if (at % 65536 === 65535) yield undefined;
    }
  }

  *finish(): Generator<Uint8Array | undefined, void, void> {
    let work = 0;
    // Buffered encoders historically pad missing RGB samples with white.
    while (!this.complete) {
      const count = this.pixel();
      for (let i = 0; i < count; i++) { const output = this.byte(this.samples[i]!); if (output) yield output; }
      if (++work % 16384 === 0) yield undefined;
    }
  }
}

/** Encode incremental RGBA bytes without retaining a bitmap or encoded file.
 * Alpha is ignored; truncated pixels retain the buffered API's white padding. */
export async function* encodePortableBitmapChunks(format: PdfPortableBitmapFormat, width: number, height: number,
  source: AsyncIterable<Uint8Array>, options: PdfPortableBitmapOptions = {}): AsyncGenerator<Uint8Array, void, void> {
  const { signal } = options; signal?.throwIfAborted();
  const encoder = new PortableBitmapEncoder(format, width, height, options);
  for (let at = 0; at < encoder.header.length; at += encoder.chunkBytes) { signal?.throwIfAborted(); yield encoder.header.slice(at, at + encoder.chunkBytes); }
  let work = 0;
  for await (const bytes of readBytes(source, signal)) {
    for (const output of encoder.push(bytes)) {
      signal?.throwIfAborted();
      if (output) yield output;
      else if (++work % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
    }
    if (encoder.complete) break;
  }
  for (const output of encoder.finish()) {
    signal?.throwIfAborted();
    if (output) yield output;
    else if (++work % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
  }
}

export function* encodePortableBitmapSteps(format: PdfPortableBitmapFormat, bitmap: { readonly width: number; readonly height: number; readonly data: Uint8Array }): Generator<void, Uint8Array, void> {
  const encoder = new PortableBitmapEncoder(format, bitmap.width, bitmap.height);
  const output = new Uint8Array(encoder.size); output.set(encoder.header); let position = encoder.header.length;
  for (const chunk of encoder.push(bitmap.data)) { if (chunk) { output.set(chunk, position); position += chunk.length; } yield; }
  for (const chunk of encoder.finish()) { if (chunk) { output.set(chunk, position); position += chunk.length; } yield; }
  return output;
}
