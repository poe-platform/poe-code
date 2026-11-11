import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { defaultRuntime } from "@poe-code/compression";

// Version-zero, one-bit Palm bitmaps have a 16-byte header and no color table.
export function isPalmBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && (bytes[6] === 0 || bytes[6] === 0x40) && bytes[7] === 0
    && bytes[8] === 1 && bytes[9] === 0 && bytes[12] === 0
    && (bytes[13] === 0 || bytes[13] === 0xff) && bytes[14] === 0 && bytes[15] === 0;
}

export function readPalmHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isPalmBytes(bytes)) throw new Error("Unsupported PALM header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(0), height = view.getUint16(2), stride = view.getUint16(4), offset = 16;
  if (!width || !height || stride % 2 || stride < Math.ceil(width / 16) * 2) throw new Error("Invalid PALM dimensions or row size");
  if (size < offset + stride * height) throw new Error("Truncated PALM pixels");
  const metadata: ImageMetadata = { format: "palm", width, height, channels: 1, space: "b-w", depth: "uchar", bitsPerSample: 1, hasAlpha: false, density: 72, size };
  return { metadata, offset, stride };
}

// Set bits are black, most-significant first; rows are padded to 16-bit words.
function* palmPixels(header: ReturnType<typeof readPalmHeader>): Generator<number | Uint8Array, void, number | undefined> {
  const { metadata: { width, height }, offset, stride } = header;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 1024) {
      const count = Math.min(1024, width - x), pixels = new Uint8Array(count * 4);
      for (let i = 0; i < count; i += 8) {
        const byte = yield offset + y * stride + (x + i) / 8;
        if (byte === undefined) throw new Error("Truncated PALM pixels");
        for (let bit = 0; bit < Math.min(8, count - i); bit++) {
          const value = byte & (128 >> bit) ? 0 : 255, dest = (i + bit) * 4;
          pixels[dest] = value; pixels[dest + 1] = value; pixels[dest + 2] = value; pixels[dest + 3] = 255;
        }
      }
      yield pixels;
    }
  }
}

export function decodePalmImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readPalmHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = palmPixels(header);
  let step = steps.next(), offset = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(bytes[step.value]);
    else { data.set(step.value, offset); offset += step.value.length; step = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodePalmToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const reader = new SourceBytes(source, signal, "PALM"), bytes = new Uint8Array(Math.min(16, source.size));
  for (let i = 0; i < bytes.length; i++) bytes[i] = (await reader.at(i))!;
  const header = readPalmHeader(bytes, source.size), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), steps = palmPixels(header);
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
