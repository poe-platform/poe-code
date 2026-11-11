import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

export function isTgaBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 18 || (bytes[17]! & 0xc0) !== 0
    || bytes[12]! + bytes[13]! * 256 === 0 || bytes[14]! + bytes[15]! * 256 === 0) return false;
  if (bytes[1] === 1 && (bytes[2] === 1 || bytes[2] === 9)) {
    const first = bytes[3]! + bytes[4]! * 256, count = bytes[5]! + bytes[6]! * 256;
    return count > 0 && first + count <= 65536 && (bytes[16] === 8 || bytes[16] === 16)
      && (bytes[7] === 24 || bytes[7] === 32)
      && ((bytes[17]! & 15) === 0 || (bytes[7] === 32 && (bytes[17]! & 15) === 8));
  }
  const grayscale = bytes[2] === 3 || bytes[2] === 11;
  return bytes[1] === 0 && (grayscale || bytes[2] === 2 || bytes[2] === 10)
    && bytes.subarray(3, 8).every(byte => byte === 0)
    && (grayscale ? bytes[16] === 8 : bytes[16] === 16 || bytes[16] === 24 || bytes[16] === 32) && (bytes[17]! & 0xc0) === 0
    && (bytes[16] === 16 ? (bytes[17]! & 15) <= 1 : ((bytes[17]! & 15) === 0 || (bytes[16] === 32 && (bytes[17]! & 15) === 8)))
    && (bytes[12]! + bytes[13]! * 256) > 0 && (bytes[14]! + bytes[15]! * 256) > 0;
}

export function readTgaMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isTgaBytes(bytes)) throw new Error("Unsupported TGA header");
  const hasAlpha = bytes[1] === 1 ? bytes[7] === 32 : bytes[16] === 32 || (bytes[16] === 16 && (bytes[17]! & 15) === 1);
  const grayscale = bytes[2] === 3 || bytes[2] === 11;
  const width = bytes[12]! + bytes[13]! * 256, height = bytes[14]! + bytes[15]! * 256;
  const x = bytes[8]! + bytes[9]! * 256, y = bytes[10]! + bytes[11]! * 256;
  return { format: "tga", width, height, ...(x || y ? { virtualCanvas: { width, height, x, y } } : {}),
    tgaCompression: bytes[2] === 9 || bytes[2] === 10 || bytes[2] === 11 ? "rle" : "none",
    channels: grayscale ? 1 : hasAlpha ? 4 : 3, hasAlpha, isPalette: bytes[1] === 1, depth: "uchar", space: grayscale ? "b-w" : "srgb", density: 72, orientation: 1, size: bytes.length };
}

/** Byte requests and bounded pixel spans share the same packet and origin handling. */
function* tgaPixels(header: Uint8Array): Generator<number | { position: number; data: Uint8Array }, void, number | undefined> {
  const { width, height, hasAlpha } = readTgaMetadata(header);
  let offset = 18 + header[0]!, remaining = 0, repeat = false;
  const indexed = header[1] === 1, rle = header[2] === 9 || header[2] === 10 || header[2] === 11;
  const stride = header[16]! / 8, colorStride = indexed ? header[7]! / 8 : stride;
  const first = header[3]! + header[4]! * 256;
  const palette = new Uint8Array((header[5]! + header[6]! * 256) * colorStride);
  for (let i = 0; i < palette.length; i++) {
    const value = yield offset++;
    if (value === undefined) throw new Error("Truncated TGA color map");
    palette[i] = value;
  }
  const pixel = new Uint8Array(4);
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
        const color = indexed ? (pixel[0]! + (stride === 2 ? pixel[1]! * 256 : 0) - first) * colorStride : 0;
        if (indexed && (color < 0 || color >= palette.length)) throw new Error("TGA color map index out of range");
        const colors = indexed ? palette : pixel;
        if (colorStride === 2) {
          const packed = pixel[0]! | (pixel[1]! << 8);
          for (let c = 0; c < 3; c++) {
            const sample = (packed >> ((2 - c) * 5)) & 31;
            data[dest + c] = (sample << 3) | (sample >> 2);
          }
          data[dest + 3] = hasAlpha && !(packed & 0x8000) ? 0 : 255;
        } else {
          data[dest] = colors[color + (colorStride === 1 ? 0 : 2)]!; data[dest + 1] = colors[color + (colorStride === 1 ? 0 : 1)]!; data[dest + 2] = colors[color]!;
          data[dest + 3] = colorStride === 4 ? colors[color + 3]! : 255;
        }
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
