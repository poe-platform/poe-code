import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { defaultRuntime } from "@poe-code/compression";

export function isOtbBytes(bytes: Uint8Array): boolean {
  return (bytes[0] === 0 && bytes[1]! > 0 && bytes[2]! > 0 && bytes[3] === 1)
    || (bytes[0] === 16 && bytes[1]! * 256 + bytes[2]! > 0 && bytes[3]! * 256 + bytes[4]! > 0 && bytes[5] === 1);
}

export function readOtbHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isOtbBytes(bytes)) throw new Error("Unsupported OTB header");
  const extended = bytes[0] === 16, offset = extended ? 6 : 4;
  const width = extended ? bytes[1]! * 256 + bytes[2]! : bytes[1]!;
  const height = extended ? bytes[3]! * 256 + bytes[4]! : bytes[2]!;
  if (!width || !height) throw new Error("Invalid OTB dimensions");
  const stride = Math.ceil(width / 8);
  if (size < offset + stride * height) throw new Error("Truncated OTB pixels");
  const metadata: ImageMetadata = { format: "otb", width, height, channels: 1, space: "b-w", depth: "uchar", bitsPerSample: 1, hasAlpha: false, density: 72, size };
  return { metadata, offset, stride };
}

// OTB stores black pixels as set bits, most-significant first, with byte-padded rows.
function* otbPixels(header: ReturnType<typeof readOtbHeader>): Generator<number | Uint8Array, void, number | undefined> {
  const { metadata: { width, height }, offset, stride } = header;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 1024) {
      const count = Math.min(1024, width - x), pixels = new Uint8Array(count * 4);
      for (let i = 0; i < count; i += 8) {
        const byte = yield offset + y * stride + (x + i) / 8;
        if (byte === undefined) throw new Error("Truncated OTB pixels");
        for (let bit = 0; bit < Math.min(8, count - i); bit++) {
          const value = byte & (128 >> bit) ? 0 : 255, dest = (i + bit) * 4;
          pixels[dest] = value; pixels[dest + 1] = value; pixels[dest + 2] = value; pixels[dest + 3] = 255;
        }
      }
      yield pixels;
    }
  }
}

export function decodeOtbImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readOtbHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = otbPixels(header);
  let step = steps.next(), offset = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(bytes[step.value]);
    else { data.set(step.value, offset); offset += step.value.length; step = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodeOtbToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const reader = new SourceBytes(source, signal, "OTB"), bytes = new Uint8Array(Math.min(6, source.size));
  for (let i = 0; i < bytes.length; i++) bytes[i] = (await reader.at(i))!;
  const header = readOtbHeader(bytes, source.size), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), steps = otbPixels(header);
  let step = steps.next(), offset = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(await reader.at(step.value));
    else {
      await defaultRuntime.yieldTurn(signal);
      signal.throwIfAborted();
      await storage.write(position + offset, step.value, { signal });
      offset += step.value.length; step = steps.next();
    }
  }
  signal.throwIfAborted();
  return { ...metadata, position };
}
