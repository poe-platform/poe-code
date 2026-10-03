import type { RgbaImage } from "../ast.js";
export interface GifOptions {
  readonly pageHeight?: number;
  readonly delay?: number | readonly number[];
  readonly loop?: number;
}
export type GifImage = Pick<RgbaImage, "width" | "height" | "pageHeight" | "delay" | "loop">;
/** The wire palette is fixed at 256 entries, independent of raster size. */
export class GifPalette {
  readonly bytes = new Uint8Array(768);
  private readonly colors = new Map<number, number>();
  private readonly used = new Set<number>();
  private readonly missing = new Set<number>();
  constructor() {
    for (let i = 0; i < 254; i++) {
      const r = Math.round((((i >>> 5) & 7) * 255) / 7),
        g = Math.round((((i >>> 2) & 7) * 255) / 7),
        b = Math.round(((i & 3) * 255) / 3);
      this.bytes.set([r, g, b], i * 3);
      this.colors.set((r << 16) | (g << 8) | b, i);
    }
    this.bytes.set([255, 255, 255], 254 * 3);
    this.colors.set(0xffffff, 254);
  }
  add(r: number, g: number, b: number, a: number) {
    if (a < 128) return;
    const key = (r << 16) | (g << 8) | b,
      existing = this.colors.get(key);
    if (existing !== undefined) this.used.add(existing);
    else if (this.missing.size < 255) this.missing.add(key);
  }
  finish() {
    if (this.used.size + this.missing.size <= 254) {
      let probe = 1;
      for (const key of this.missing) {
        while (probe < 254 && this.used.has(probe)) probe++;
        if (probe >= 254) break;
        this.used.add(probe);
        this.colors.set(key, probe);
        this.bytes.set([(key >>> 16) & 255, (key >>> 8) & 255, key & 255], probe * 3);
      }
    }
  }
  index(r: number, g: number, b: number, a: number) {
    if (a < 128) return 255;
    const exact = this.colors.get((r << 16) | (g << 8) | b);
    if (exact !== undefined) return exact;
    const value = ((r >>> 5) << 5) | ((g >>> 5) << 2) | (b >>> 6);
    return value === 255 ? 254 : value;
  }
}
export function gifLayout(image: GifImage, options: GifOptions = {}) {
  const { width, height } = image,
    pageHeight = options.pageHeight ?? image.pageHeight;
  const frames =
      pageHeight !== undefined && pageHeight > 0 && pageHeight < height && height % pageHeight === 0
        ? height / pageHeight
        : 1,
    frameHeight = frames > 1 ? pageHeight! : height;
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > 65535 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(width * height * 4) ||
    !Number.isSafeInteger(frameHeight) ||
    frameHeight > 65535
  )
    throw new RangeError("GIF dimensions exceed 16-bit frame fields");
  return { width, height, frames, frameHeight, framePixels: width * frameHeight };
}
export function gifHeader(
  image: GifImage,
  options: GifOptions,
  layout: ReturnType<typeof gifLayout>,
  palette: GifPalette
) {
  const { width, frameHeight, frames } = layout,
    loop = options.loop ?? image.loop ?? (frames > 1 ? 0 : undefined),
    out = new Uint8Array(13 + 768 + (loop === undefined ? 0 : 19));
  out.set([
    71,
    73,
    70,
    56,
    57,
    97,
    width & 255,
    width >>> 8,
    frameHeight & 255,
    frameHeight >>> 8,
    247,
    0,
    0
  ]);
  out.set(palette.bytes, 13);
  if (loop !== undefined) {
    const value = loop === 0 ? 0 : Math.max(0, loop - 1);
    out.set(
      [
        33,
        255,
        11,
        78,
        69,
        84,
        83,
        67,
        65,
        80,
        69,
        50,
        46,
        48,
        3,
        1,
        value & 255,
        (value >>> 8) & 255,
        0
      ],
      781
    );
  }
  return out;
}
export function gifFrameHeader(
  image: GifImage,
  options: GifOptions,
  layout: ReturnType<typeof gifLayout>,
  frame: number,
  transparent: boolean,
  frameDelay = image.delay?.[frame]
) {
  const { width, frameHeight, frames } = layout,
    delay = Array.isArray(options.delay)
      ? (options.delay[frame] ?? options.delay[options.delay.length - 1] ?? 100)
      : typeof options.delay === "number"
        ? options.delay
        : (frameDelay ?? (frames > 1 ? 100 : 0)),
    centiseconds = Math.max(0, Math.round(delay / 10));
  const gce = frames > 1 || transparent || options.delay !== undefined,
    out = new Uint8Array(gce ? 19 : 11);
  if (gce)
    out.set([
      33,
      249,
      4,
      (frames > 1 ? 4 : 0) | 1,
      centiseconds & 255,
      (centiseconds >>> 8) & 255,
      255,
      0
    ]);
  out.set(
    [44, 0, 0, 0, 0, width & 255, width >>> 8, frameHeight & 255, frameHeight >>> 8, 0, 8],
    gce ? 8 : 0
  );
  return out;
}
/** Nine-bit GIF codes, packed into owned 255-byte data subblocks. */
export class GifCodes {
  private bytes = new Uint8Array(256);
  private used = 1;
  private bits = 0;
  private count = 0;
  code(code: number): Uint8Array | undefined {
    let complete: Uint8Array | undefined;
    this.bits |= (code & 511) << this.count;
    this.count += 9;
    while (this.count >= 8) {
      this.bytes[this.used++] = this.bits & 255;
      this.bits >>>= 8;
      this.count -= 8;
      if (this.used === 256) {
        this.bytes[0] = 255;
        complete = this.bytes;
        this.bytes = new Uint8Array(256);
        this.used = 1;
      }
    }
    return complete;
  }
  *finish() {
    const complete = this.code(257);
    if (complete) yield complete;
    if (this.count > 0) this.bytes[this.used++] = this.bits & 255;
    if (this.used > 1) {
      this.bytes[0] = this.used - 1;
      yield this.bytes.slice(0, this.used);
    }
    yield Uint8Array.of(0);
  }
}
