import { encode, createRiffContainer, parseRiff, type WebpImageData } from "@stacksjs/ts-webp";
import { encodeVP8 } from "./webp-vp8/encoder.js";
import type { RgbaImage } from "../ast.js";
import { buildExifApp1Segment } from "./exif.js";
import type { createWebpEncoder } from "./webp.js";

/** Assemble encoded frames, preserving alpha, timing, ICC and EXIF in the RIFF container. */
export function assembleLossyWebp(
  image: Pick<RgbaImage, "width" | "height" | "density" | "orientation" | "loop" | "icc">,
  frames: readonly Uint8Array[], height: number, delays: readonly number[],
  options?: Parameters<typeof createWebpEncoder>[2]
): Uint8Array {
  const chunk = (name: string, data: Uint8Array) => {
    const bytes = new Uint8Array(8 + data.length + (data.length & 1));
    bytes.set(new TextEncoder().encode(name));
    new DataView(bytes.buffer).setUint32(4, data.length, true);
    bytes.set(data, 8);
    return bytes;
  };
  const parts: Uint8Array[] = [];
  const animated = frames.length > 1;
  const density = options?.density ?? image.density ?? 72;
  const orientation = options?.orientation ?? image.orientation ?? 1;
  const exif = density !== 72 || orientation !== 1
    ? buildExifApp1Segment({ density, orientation }).subarray(6) : undefined;
  let alpha = false;
  for (let index = 0; index < frames.length; index++) {
    const bytes = frames[index]!;
    const payloads: Uint8Array[] = [];
    for (let at = 12; at < bytes.length;) {
      const size = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0, true);
      const name = String.fromCharCode(...bytes.subarray(at, at + 4));
      if (name === "ALPH") alpha = true;
      if (name !== "VP8X") payloads.push(bytes.subarray(at, at + 8 + size + (size & 1)));
      at += 8 + size + (size & 1);
    }
    if (animated) {
      const delay = delays[index] ?? 0;
      if (!Number.isInteger(delay) || delay < 0 || delay > 0xffffff) throw new RangeError("Invalid WebP frame duration");
      const data = new Uint8Array(16 + payloads.reduce((n, p) => n + p.length, 0));
      const w = image.width - 1, h = height - 1;
      data.set([w & 255, w >>> 8, 0, h & 255, h >>> 8, 0], 6);
      data.set([delay & 255, (delay >>> 8) & 255, (delay >>> 16) & 255, 2], 12);
      let at = 16;
      for (const payload of payloads) { data.set(payload, at); at += payload.length; }
      parts.push(chunk("ANMF", data));
    } else parts.push(...payloads);
  }
  if (animated) {
    const anim = new Uint8Array(6);
    new DataView(anim.buffer).setUint16(4, options?.loop ?? image.loop ?? 0, true);
    parts.unshift(chunk("ANIM", anim));
  }
  if (image.icc) parts.unshift(chunk("ICCP", image.icc));
  if (animated || alpha || exif || image.icc) {
    const extended = new Uint8Array(10), w = image.width - 1, h = height - 1;
    extended[0] = (animated ? 2 : 0) | (alpha ? 16 : 0) | (exif ? 8 : 0) | (image.icc ? 32 : 0);
    extended.set([w & 255, w >>> 8, 0, h & 255, h >>> 8, 0], 4);
    parts.unshift(chunk("VP8X", extended));
  }
  if (exif) parts.push(chunk("EXIF", exif));
  const size = 12 + parts.reduce((n, p) => n + p.length, 0);
  if (size - 8 > 0xffffffff) throw new RangeError("WebP exceeds RIFF size range");
  const output = new Uint8Array(size);
  output.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  new DataView(output.buffer).setUint32(4, size - 8, true);
  let at = 12;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}

/** Fit VP8 coefficient probabilities without changing quantization or decoded pixels. */
export function encodeLossyWebp(image: WebpImageData, options: { quality: number; effort: number; smartSubsample?: boolean; alphaQuality?: number; alphaCompression?: 0 | 1 }): Uint8Array {
  if (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 100)
    throw new RangeError("WebP quality must be from 0 to 100");
  const alphaCompression = options.alphaCompression ?? 1;
  if (alphaCompression !== 0 && alphaCompression !== 1) throw new RangeError("WebP alpha compression must be 0 or 1");
  const alphaQuality = options.alphaQuality ?? 100;
  if (!Number.isInteger(alphaQuality) || alphaQuality < 0 || alphaQuality > 100)
    throw new RangeError("WebP alpha quality must be an integer from 0 to 100");
  // Match libwebp's quality-to-level schedule; quantize only the separate alpha plane.
  const levels = alphaQuality <= 70 ? 2 + Math.floor(alphaQuality / 5) : 16 + (alphaQuality - 70) * 8;
  const vp8 = { fourCC: "VP8 ", data: encodeVP8(image, { quality: Math.round(127 - options.quality / 100 * 127), effort: options.effort, smartSubsample: options.smartSubsample ?? false }) };
  let hasAlpha = false;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) { hasAlpha = true; break; }
  if (!hasAlpha) return createRiffContainer([vp8]);
  const alpha = new Uint8Array(image.data.length);
  for (let i = 0; i < alpha.length; i += 4) { alpha[i + 1] = alphaQuality === 100 ? image.data[i + 3]! : Math.round(Math.round(image.data[i + 3]! * (levels - 1) / 255) * 255 / (levels - 1)); alpha[i + 3] = 255; }
  const payload = alphaCompression === 0
    ? alpha.filter((_, i) => i % 4 === 1)
    : parseRiff(encode({ ...image, data: alpha, hasAlpha: false }, { lossless: true }))[0]!.data.subarray(5);
  const alph = new Uint8Array(payload.length + 1);
  alph[0] = alphaCompression | (alphaQuality < 100 ? 16 : 0);
  alph.set(payload, 1);
  const extended = new Uint8Array(10), w = image.width - 1, h = image.height - 1;
  extended[0] = 16;
  extended.set([w & 255, w >>> 8, 0, h & 255, h >>> 8, 0], 4);
  return createRiffContainer([{ fourCC: "VP8X", data: extended }, { fourCC: "ALPH", data: alph }, vp8]);
}
