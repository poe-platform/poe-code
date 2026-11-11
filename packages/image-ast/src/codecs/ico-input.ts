import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import { decodePngImage, isPngBytes, readPngMetadata } from "./png.js";

export function isIcoBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0;
}

export function* icoEntrySteps(size: number, options?: SharpInputOptions): Generator<{ position: number; length: number }, { metadata: ImageMetadata; position: number; length: number }, Uint8Array> {
  const header = yield { position: 0, length: 6 };
  if (!isIcoBytes(header)) throw new Error("Invalid ICO directory");
  const format = header[2] === 1 ? "ico" : "cur";
  const pages = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint16(4, true), page = options?.page ?? 0;
  if (!pages || 6 + pages * 16 > size) throw new Error("Truncated ICO directory");
  if (!Number.isInteger(page) || page < 0 || page >= pages) throw new Error("ICO page out of range");
  const entry = yield { position: 6 + page * 16, length: 16 };
  const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
  let width = entry[0] || 256, height = entry[1] || 256;
  const length = view.getUint32(8, true), position = view.getUint32(12, true);
  if (length < 8 || position < 6 + pages * 16 || position + length > size) throw new Error("Invalid ICO image range");
  const payload = yield { position, length: Math.min(length, 40) };
  if (!isPngBytes(payload)) {
    if (payload.length < 40) throw new Error("Truncated ICO DIB");
    const dib = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    if (dib.getUint32(0, true) < 40 || dib.getUint32(0, true) > length) throw new Error("Unsupported ICO DIB layout");
    // Native DIB entries wrap directory dimensions at 256; the bitmap stores
    // the full width and twice the height (XOR bitmap plus AND mask).
    width = dib.getInt32(4, true); height = dib.getInt32(8, true) / 2;
    if (width < 1 || height < 1 || !Number.isInteger(height) || width % 256 !== entry[0] || height % 256 !== entry[1]) throw new Error("Unsupported ICO DIB dimensions");
  }
  checkLimitInputPixels(width, height, options);
  return { position, length, metadata: { format, width, height, pages, space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, size } };
}

export function readIcoEntry(bytes: Uint8Array, options?: SharpInputOptions) {
  const steps = icoEntrySteps(bytes.length, options);
  let next = steps.next();
  while (!next.done) {
    const { position, length } = next.value;
    if (position + length > bytes.length) throw new Error("Truncated ICO source");
    next = steps.next(bytes.subarray(position, position + length));
  }
  return next.value;
}

/** Icon DIBs store a bottom-up XOR bitmap followed by a one-bit AND mask. */
export function decodeIcoDib(bytes: Uint8Array, metadata: ImageMetadata): RgbaImage {
  if (bytes.length < 40) throw new Error("Truncated ICO DIB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), header = view.getUint32(0, true);
  const { width, height } = metadata, bits = view.getUint16(14, true);
  if (header < 40 || header > bytes.length || view.getInt32(4, true) !== width || view.getInt32(8, true) !== height * 2 || view.getUint16(12, true) !== 1 || view.getUint32(16, true) !== 0 || ![1,4,8,24,32].includes(bits)) throw new Error("Unsupported ICO DIB layout");
  const colors = bits <= 8 ? view.getUint32(32, true) || 2 ** bits : 0;
  if (colors > 2 ** bits) throw new Error("Invalid ICO palette");
  const start = header + colors * 4, stride = Math.ceil(width * bits / 32) * 4, maskStride = Math.ceil(width / 32) * 4, mask = start + stride * height;
  if (mask > bytes.length || (bits !== 32 && mask + maskStride * height > bytes.length) || (mask < bytes.length && mask + maskStride * height > bytes.length)) throw new Error("Truncated ICO bitmap");
  const data = new Uint8Array(width * height * 4);
  let alpha = false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = start + (height - 1 - y) * stride, target = (y * width + x) * 4;
    let pixel = row + x * (bits / 8);
    if (bits <= 8) {
      const index = (bytes[row + Math.floor(x * bits / 8)]! >> (8 - bits - x * bits % 8)) & (2 ** bits - 1);
      if (index >= colors) throw new Error("Invalid ICO palette index");
      pixel = header + index * 4;
    }
    data[target] = bytes[pixel + 2]!; data[target + 1] = bytes[pixel + 1]!; data[target + 2] = bytes[pixel]!;
    data[target + 3] = bits === 32 ? bytes[pixel + 3]! : 255;
    alpha ||= bits === 32 && data[target + 3] !== 0;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const target = (y * width + x) * 4 + 3;
    if (bits === 32 && !alpha) data[target] = 255;
    if (mask + maskStride * height <= bytes.length && (bytes[mask + (height - 1 - y) * maskStride + (x >> 3)]! & (128 >> (x % 8)))) data[target] = 0;
  }
  return { ...metadata, data };
}

export function decodeIcoImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const { metadata, position, length } = readIcoEntry(bytes, options), payload = bytes.subarray(position, position + length);
  if (!isPngBytes(payload)) return decodeIcoDib(payload, metadata);
  const png = readPngMetadata(payload);
  if (png.width !== metadata.width || png.height !== metadata.height) throw new Error("ICO PNG dimensions disagree with directory");
  return { ...decodePngImage(payload), ...metadata };
}
