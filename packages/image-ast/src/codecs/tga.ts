import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

export function isTgaBytes(bytes: Uint8Array): boolean {
  const grayscale = bytes[2] === 3 || bytes[2] === 11;
  return bytes.length >= 18 && bytes[1] === 0 && (grayscale || bytes[2] === 2 || bytes[2] === 10)
    && bytes.subarray(3, 8).every(byte => byte === 0)
    && (grayscale ? bytes[16] === 8 : bytes[16] === 24 || bytes[16] === 32) && (bytes[17]! & 0xc0) === 0
    && (bytes[17]! & 15) === (bytes[16] === 32 ? 8 : 0)
    && (bytes[12]! + bytes[13]! * 256) > 0 && (bytes[14]! + bytes[15]! * 256) > 0;
}

export function readTgaMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isTgaBytes(bytes)) throw new Error("Unsupported TGA header");
  const hasAlpha = bytes[16] === 32, grayscale = bytes[16] === 8;
  return { format: "tga", width: bytes[12]! + bytes[13]! * 256, height: bytes[14]! + bytes[15]! * 256,
    channels: grayscale ? 1 : hasAlpha ? 4 : 3, hasAlpha, depth: "uchar", space: grayscale ? "b-w" : "srgb", density: 72, size: bytes.length };
}

/** Byte requests and bounded pixel spans share the same packet and origin handling. */
function* tgaPixels(header: Uint8Array): Generator<number | { position: number; data: Uint8Array }, void, number | undefined> {
  const { width, height } = readTgaMetadata(header);
  let offset = 18 + header[0]!, remaining = 0, repeat = false;
  const pixel = new Uint8Array(4), stride = header[16]! / 8;
  const rle = header[2] === 10 || header[2] === 11;
  const top = (header[17]! & 32) !== 0, right = (header[17]! & 16) !== 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width;) {
      const count = Math.min(1024, width - x), data = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        const newPacket = rle && remaining === 0;
        if (newPacket) {
          const packet = yield offset++;
          if (packet === undefined) throw new Error("Truncated TGA packet");
          remaining = (packet & 127) + 1; repeat = (packet & 128) !== 0;
          if (remaining > width * height - (y * width + x + i)) throw new Error("TGA packet exceeds image dimensions");
        }
        if (newPacket || !rle || !repeat) {
          for (let c = 0; c < stride; c++) {
            const value = yield offset++;
            if (value === undefined) throw new Error("Truncated TGA pixels");
            pixel[c] = value;
          }
        }
        remaining--;
        const dest = (right ? count - 1 - i : i) * 4;
        data[dest] = pixel[stride === 1 ? 0 : 2]!; data[dest + 1] = pixel[stride === 1 ? 0 : 1]!; data[dest + 2] = pixel[0]!;
        data[dest + 3] = stride === 4 ? pixel[3]! : 255;
      }
      yield { position: ((top ? y : height - 1 - y) * width + (right ? width - x - count : x)) * 4, data };
      x += count;
    }
  }
}

export function decodeTgaImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const metadata = readTgaMetadata(bytes);
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = tgaPixels(bytes);
  let next = steps.next();
  while (!next.done) {
    if (typeof next.value === "number") next = steps.next(bytes[next.value]);
    else { data.set(next.value.data, next.value.position); next = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodeTgaToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const reader = new SourceBytes(source, signal, "TGA"), header = new Uint8Array(18);
  for (let i = 0; i < header.length; i++) {
    const value = await reader.at(i);
    if (value === undefined) throw new Error("Truncated TGA header");
    header[i] = value;
  }
  const metadata = readTgaMetadata(header);
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), steps = tgaPixels(header);
  let next = steps.next();
  while (!next.done) {
    signal.throwIfAborted();
    if (typeof next.value === "number") next = steps.next(await reader.at(next.value));
    else { await storage.write(position + next.value.position, next.value.data, { signal }); next = steps.next(); }
  }
  return { ...metadata, position };
}
