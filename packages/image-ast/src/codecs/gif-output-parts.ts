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
export type GifImage = Pick<RgbaImage, "width" | "height" | "pageHeight" | "delay" | "loop" | "disposal" | "virtualCanvas" | "gifFrames" | "backgroundColor" | "icc" | "gifApplications" | "properties" | "gifCommentBytes">;
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
  /** PNG has no fixed table size: omit unused entries and remap raster indices. */
  finishPng() {
    this.finish();
    const used = this.quantized ? new Set<number>() : this.used;
    if (this.quantized) {
      for (let i = 0; i < this.quantized.length; i++) {
        if (this.histogram[i * 4 + 3]) used.add(this.quantized[i]!);
      }
      if (this.used.has(254)) used.add(254);
    }
    if (this.hasTransparentColor) used.add(255);
    const entries = [...used].sort((a, b) => a - b);
    const indices = new Uint8Array(256);
    const bytes = new Uint8Array(entries.length * 3);
    entries.forEach((entry, index) => {
      indices[entry] = index;
      bytes.set(entry === 255 ? [255, 255, 255] : this.bytes.subarray(entry * 3, entry * 3 + 3), index * 3);
    });
    const transparency = this.hasTransparentColor ? new Uint8Array(entries.length).fill(255) : undefined;
    if (transparency) transparency[indices[255]!] = 0;
    return { bytes, indices, transparency };
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
  palette: GifPalette,
  firstFrame = image.gifFrames?.[0]
) {
  // Packed rasters include padding for later frames; it does not enlarge the screen.
  const { frames } = layout,
    width = Math.max(image.virtualCanvas?.width ?? 0, firstFrame?.width ?? layout.width),
    frameHeight = Math.max(image.virtualCanvas?.height ?? 0, firstFrame?.height ?? layout.frameHeight),
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
    const value = loop === 0 ? 0 : loop - 1;
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
  rectangle: { readonly icc?: Uint8Array | undefined; readonly gifApplications?: Readonly<Record<string, Uint8Array>> | undefined; left: number; top: number; width: number; height: number; comment?: string | undefined; gifCommentBytes?: Uint8Array | undefined } = { left: 0, top: 0, width: layout.width, height: layout.frameHeight }
) {
  const { frames } = layout,
    { width, height } = rectangle,
    left = Math.max(0, rectangle.left),
    top = Math.max(0, rectangle.top),
    delay = Array.isArray(options.delay)
      ? (options.delay[frame] ?? options.delay[options.delay.length - 1] ?? 100)
      : typeof options.delay === "number"
        ? options.delay
        : (frameDelay ?? (frames > 1 ? 100 : 0)),
    // ImageMagick's 64-bit size_t multiplication wraps before division by
    // the default 100 ticks/second. Keep signed counts exact until encoding.
    centiseconds = delay < 0
      ? Number((BigInt.asUintN(64, BigInt(Math.floor(delay / 10)) * 100n) / 100n) & 65535n)
      : Math.floor(delay / 10);
  const text = options.gifVersion === "87a" ? undefined : rectangle.comment ?? (frame === 0 ? image.properties?.comment : undefined);
  const original = rectangle.gifCommentBytes ?? (frame === 0 ? image.gifCommentBytes : undefined);
  const bytes = original && text === new TextDecoder().decode(original) ? original : new TextEncoder().encode(text);
  const nul = bytes.indexOf(0);
  const comment = nul < 0 ? bytes : bytes.subarray(0, nul);
  const commentSize = bytes.length ? 3 + comment.length + Math.ceil(comment.length / 255) : 0;
  const icc = "icc" in rectangle ? rectangle.icc : image.icc;
  const applications = options.gifVersion === "87a" ? [] : Object.entries({ ...(rectangle.gifApplications ?? (frame === 0 ? image.gifApplications : undefined)), ...(icc ? { ICCRGBG1012: icc } : {}) });
  const applicationSize = applications.reduce((size, [name, payload]) => size + (name.length === 11 ? 15 + payload.length + Math.ceil(payload.length / 255) : 0), 0);
  const gce = options.gifVersion !== "87a" && (frames > 1 || transparent || options.delay !== undefined || frameDisposal !== undefined),
    out = new Uint8Array(applicationSize + commentSize + (gce ? 19 : 11) + (options.globalPalette === false ? 768 : 0));
  let applicationAt = 0;
  for (const [name, payload] of applications) {
    if (name.length !== 11) continue;
    out.set([33, 255, 11], applicationAt); applicationAt += 3;
    for (let i = 0; i < 11; i++) out[applicationAt++] = name.charCodeAt(i);
    for (let offset = 0; offset < payload.length; offset += 255) {
      const part = payload.subarray(offset, offset + 255);
      out[applicationAt++] = part.length; out.set(part, applicationAt); applicationAt += part.length;
    }
    out[applicationAt++] = 0;
  }
  if (commentSize) {
    let at = applicationSize;
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
    ], applicationSize + commentSize);
  out.set(
    [44, left & 255, left >>> 8, top & 255, top >>> 8, width & 255, width >>> 8, height & 255, height >>> 8, (options.gifInterlace ? 64 : 0) | (options.globalPalette === false ? 135 : 0)],
    applicationSize + commentSize + (gce ? 8 : 0)
  );
  if (options.globalPalette === false) out.set(palette.bytes, applicationSize + commentSize + (gce ? 18 : 10));
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
