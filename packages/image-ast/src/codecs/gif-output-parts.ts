import { quantizeGif } from "./gif-quantization.js";
import type { RgbaImage } from "../ast.js";
export interface GifOptions {
  readonly gifVersion?: "87a" | "89a" | undefined;
  readonly gifInterlace?: boolean | undefined;
  readonly globalPalette?: boolean | undefined;
  readonly pageHeight?: number;
  readonly delay?: number | readonly number[];
  readonly loop?: number;
  readonly transparentColor?: { readonly r: number; readonly g: number; readonly b: number } | undefined;
  readonly optimizeFrames?: boolean;
  readonly gifTransdiff?: boolean;
}
export type GifImage = Pick<RgbaImage, "width" | "height" | "pageHeight" | "delay" | "loop" | "disposal" | "virtualCanvas" | "gifFrames" | "backgroundColor" | "properties">;
/** The wire palette is fixed at 256 entries, independent of raster size. */
export class GifPalette {
  readonly bytes = new Uint8Array(768);
  private readonly colors = new Map<number, number>();
  private readonly used = new Set<number>();
  private readonly missing = new Set<number>();
  private readonly histogram = new Float64Array(32768 * 4);
  private quantized?: Uint8Array;
  private hasTransparentColor = false;
  constructor(transparentColor?: GifOptions["transparentColor"]) {
    if (transparentColor) {
      this.bytes.set([transparentColor.r, transparentColor.g, transparentColor.b], 255 * 3);
      this.hasTransparentColor = true;
    }
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
    if (a < 128) {
      if (!this.hasTransparentColor) {
        this.bytes.set([r, g, b], 255 * 3);
        this.hasTransparentColor = true;
      }
      return;
    }
    if (r !== 255 || g !== 255 || b !== 255) {
      const at = (((r >>> 3) << 10) | ((g >>> 3) << 5) | (b >>> 3)) * 4;
      this.histogram[at]! += r;
      this.histogram[at + 1]! += g;
      this.histogram[at + 2]! += b;
      this.histogram[at + 3]!++;
    }
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
    } else {
      this.quantized = quantizeGif(this.histogram, this.bytes);
    }
  }
  index(r: number, g: number, b: number, a: number) {
    if (a < 128) return 255;
    if (this.quantized) {
      if (r === 255 && g === 255 && b === 255) return 254;
      return this.quantized[((r >>> 3) << 10) | ((g >>> 3) << 5) | (b >>> 3)]!;
    }
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
  const { frames } = layout,
    width = image.virtualCanvas?.width || layout.width, frameHeight = image.virtualCanvas?.height || layout.frameHeight,
    loop = options.gifVersion === "87a" ? undefined : options.loop ?? image.loop ?? (frames > 1 ? 0 : undefined),
    headerSize = 13 + (options.globalPalette === false ? 0 : 768),
    out = new Uint8Array(headerSize + (loop === undefined || loop === 1 ? 0 : 19));
  out.set([
    71,
    73,
    70,
    56,
    options.gifVersion === "87a" ? 55 : 57,
    97,
    width & 255,
    width >>> 8,
    frameHeight & 255,
    frameHeight >>> 8,
    options.globalPalette === false ? 112 : 247,
    image.backgroundColor ? palette.index(image.backgroundColor.r, image.backgroundColor.g, image.backgroundColor.b, 255) : 0,
    0
  ]);
  if (options.globalPalette !== false) out.set(palette.bytes, 13);
  if (loop !== undefined && loop !== 1) {
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
      headerSize
    );
  }
  return out;
}
export function gifFrameHeader(
  image: GifImage,
  palette: GifPalette,
  options: GifOptions,
  layout: ReturnType<typeof gifLayout>,
  frame: number,
  transparent: boolean,
  frameDelay = image.delay?.[frame],
  frameDisposal = typeof image.disposal === "number" ? image.disposal : image.disposal?.[frame],
  rectangle: { left: number; top: number; width: number; height: number; comment?: string | undefined } = { left: 0, top: 0, width: layout.width, height: layout.frameHeight }
) {
  const { frames } = layout,
    { left, top, width, height } = rectangle,
    delay = Array.isArray(options.delay)
      ? (options.delay[frame] ?? options.delay[options.delay.length - 1] ?? 100)
      : typeof options.delay === "number"
        ? options.delay
        : (frameDelay ?? (frames > 1 ? 100 : 0)),
    centiseconds = Math.max(0, Math.round(delay / 10));
  const comment = new TextEncoder().encode(options.gifVersion === "87a" ? "" : rectangle.comment ?? (frame === 0 ? image.properties?.comment ?? "" : ""));
  const commentSize = comment.length ? 3 + comment.length + Math.ceil(comment.length / 255) : 0;
  const gce = options.gifVersion !== "87a" && (frames > 1 || transparent || options.delay !== undefined || frameDisposal !== undefined),
    out = new Uint8Array(commentSize + (gce ? 19 : 11) + (options.globalPalette === false ? 768 : 0));
  if (comment.length) {
    let at = 0;
    out.set([33,254], at); at += 2;
    for (let offset = 0; offset < comment.length; offset += 255) {
      const part = comment.subarray(offset, offset + 255);
      out[at++] = part.length; out.set(part, at); at += part.length;
    }
  }
  if (gce)
    out.set([
      33,
      249,
      4,
      ((frameDisposal ?? (frames > 1 ? 1 : 0)) << 2) | (transparent ? 1 : 0),
      centiseconds & 255,
      (centiseconds >>> 8) & 255,
      255,
      0
    ], commentSize);
  out.set(
    [44, left & 255, left >>> 8, top & 255, top >>> 8, width & 255, width >>> 8, height & 255, height >>> 8, (options.gifInterlace ? 64 : 0) | (options.globalPalette === false ? 135 : 0)],
    commentSize + (gce ? 8 : 0)
  );
  if (options.globalPalette === false) out.set(palette.bytes, commentSize + (gce ? 18 : 10));
  out[out.length - 1] = 8;
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

/** GIF stores interlaced rows in four passes, relative to each frame rectangle. */
export function* gifRows(height: number, interlace: boolean | undefined) {
  const passes = interlace ? [[0, 8], [4, 8], [2, 4], [1, 2]] : [[0, 1]];
  for (const [start, step] of passes) {
    for (let row = start!; row < height; row += step!) yield row;
  }
}
