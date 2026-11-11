import type { ImageMetadata, SharpInputOptions, RgbaImage } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

export function isSunBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x59 && bytes[1] === 0xa6 && bytes[2] === 0x6a && bytes[3] === 0x95;
}

export function readSunHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isSunBytes(bytes) || bytes.length < 32) throw new Error("Invalid SUN header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4), height = view.getUint32(8);
  if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid SUN dimensions");
  if (view.getUint32(12) !== 24 || view.getUint32(20) !== 3 || view.getUint32(24) !== 0 || view.getUint32(28) !== 0)
    throw new Error("Unsupported SUN pixel layout");
  const stride = Math.ceil(width * 3 / 2) * 2;
  if (size - 32 < stride * height) throw new Error("Truncated SUN pixels");
  const metadata: ImageMetadata = { format: "sun", width, height, channels: 3, space: "srgb", depth: "uchar", bitsPerSample: 8, density: 72, hasAlpha: false, size };
  return { metadata, stride };
}

// Type 3 stores RGB triples, top row first, with rows padded to an even byte count.
function* sunPixels(header: ReturnType<typeof readSunHeader>): Generator<{ position: number; length: number } | Uint8Array, void, Uint8Array> {
  const { metadata: { width, height }, stride } = header;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
    const count = Math.min(1024, width - x), data = new Uint8Array(count * 4);
    const bytes = yield { position: 32 + y * stride + x * 3, length: count * 3 };
    for (let i = 0; i < count; i++) {
      data[i * 4] = bytes[i * 3]!;
      data[i * 4 + 1] = bytes[i * 3 + 1]!;
      data[i * 4 + 2] = bytes[i * 3 + 2]!;
      data[i * 4 + 3] = 255;
    }
    yield data;
  }
}

export function decodeSunImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readSunHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = sunPixels(header);
  let next = steps.next(), offset = 0;
  while (!next.done) {
    if (next.value instanceof Uint8Array) { data.set(next.value, offset); offset += next.value.length; next = steps.next(); }
    else next = steps.next(bytes.subarray(next.value.position, next.value.position + next.value.length));
  }
  return { ...metadata, data };
}

export async function decodeSunToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const header = readSunHeader(await source.read(0, Math.min(32, source.size), { signal }), source.size), { metadata } = header;
  signal.throwIfAborted();
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), steps = sunPixels(header);
  let next = steps.next(), offset = 0;
  while (!next.done) {
    signal.throwIfAborted();
    if (next.value instanceof Uint8Array) {
      await storage.write(position + offset, next.value, { signal }); offset += next.value.length;
      await defaultRuntime.yieldTurn(signal);
      next = steps.next();
    } else {
      const bytes = await source.read(next.value.position, next.value.length, { signal });
      signal.throwIfAborted();
      if (!(bytes instanceof Uint8Array) || bytes.length !== next.value.length) throw new Error("Truncated SUN source");
      next = steps.next(bytes);
    }
  }
  return { ...metadata, position };
}
