import type { RgbaImage } from "../ast.js";
import { buildExifApp1Segment } from "./exif.js";
import type { createWebpEncoder } from "./webp.js";

/** Assemble encoded frames, preserving alpha, timing and EXIF in the RIFF container. */
export function assembleLossyWebp(
  image: Pick<RgbaImage, "width" | "height" | "density" | "orientation" | "loop">,
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
  if (animated || alpha || exif) {
    const extended = new Uint8Array(10), w = image.width - 1, h = height - 1;
    extended[0] = (animated ? 2 : 0) | (alpha ? 16 : 0) | (exif ? 8 : 0);
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
