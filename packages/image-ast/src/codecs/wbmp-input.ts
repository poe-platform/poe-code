import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { defaultRuntime } from "@poe-code/compression";

// Type-0 WBMP has no distinctive magic; check other binary formats first.
export function isWbmpBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0 && bytes[1] === 0;
}

export function readWbmpHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isWbmpBytes(bytes)) throw new Error("Unsupported WBMP header");
  let offset = 2;
  const dimension = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error("Truncated WBMP header");
      value = value * 128 + (byte & 127);
      if (value > 0xffffffff) throw new Error("Invalid WBMP dimension");
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid WBMP dimension");
  };
  const width = dimension(), height = dimension(), stride = Math.ceil(width / 8);
  if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid WBMP dimensions");
  if (stride * height > size - offset) throw new Error("Truncated WBMP pixels");
  const metadata: ImageMetadata = { format: "wbmp", width, height, channels: 1, space: "b-w", depth: "uchar", bitsPerSample: 1, hasAlpha: false, density: 72, size };
  return { metadata, offset, stride };
}

function* wbmpPixels(header: ReturnType<typeof readWbmpHeader>): Generator<number | Uint8Array, void, number | undefined> {
  const { metadata: { width, height }, offset, stride } = header;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
    const count = Math.min(1024, width - x), pixels = new Uint8Array(count * 4);
    for (let i = 0; i < count; i += 8) {
      const byte = yield offset + y * stride + (x + i) / 8;
      if (byte === undefined) throw new Error("Truncated WBMP pixels");
      for (let bit = 0; bit < Math.min(8, count - i); bit++) {
        const value = byte & (128 >> bit) ? 255 : 0, dest = (i + bit) * 4;
        pixels[dest] = value; pixels[dest + 1] = value; pixels[dest + 2] = value; pixels[dest + 3] = 255;
      }
    }
    yield pixels;
  }
}

export function decodeWbmpImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readWbmpHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = wbmpPixels(header);
  let step = steps.next(), offset = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(bytes[step.value]);
    else { data.set(step.value, offset); offset += step.value.length; step = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodeWbmpToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const length = Math.min(12, source.size), bytes = await source.read(0, length, { signal });
  signal.throwIfAborted();
  if (bytes.length !== length) throw new Error("Truncated WBMP source");
  const header = readWbmpHeader(bytes, source.size), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), reader = new SourceBytes(source, signal, "WBMP"), steps = wbmpPixels(header);
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
  return { ...metadata, position };
}
