import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { defaultRuntime } from "@poe-code/compression";

export function isPcxBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 10 && [0, 2, 3, 4, 5].includes(bytes[1]!);
}

export function readPcxHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isPcxBytes(bytes) || bytes.length < 128) throw new Error("Invalid PCX header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const stride = view.getUint16(66, true), encoding = bytes[2]!;
  if (width <= 0 || height <= 0 || stride < width) throw new Error("Invalid PCX dimensions or scanline size");
  if (encoding > 1 || bytes[3] !== 8 || bytes[65] !== 3) throw new Error("Unsupported PCX pixel layout");
  const x = view.getUint16(12, true), y = view.getUint16(14, true);
  const metadata: ImageMetadata = { format: "pcx", width, height, channels: 3, space: "srgb", depth: "uchar",
    density: x || 72, resolution: { x, y, unit: "inch" }, hasAlpha: false, size };
  return { metadata, stride, encoding, size };
}

// PCX stores each row as three padded planes. Share RLE validation between input paths.
function* pcxPixels(header: ReturnType<typeof readPcxHeader>): Generator<number | Uint8Array, void, number | undefined> {
  const { metadata: { width, height }, stride, encoding, size } = header;
  let offset = 128;
  function* byte(): Generator<number, number, number | undefined> {
    if (offset >= size) throw new Error("Truncated PCX pixels");
    const value = yield offset++;
    if (value === undefined) throw new Error("Truncated PCX pixels");
    return value;
  }
  const row = new Uint8Array(stride * 3);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < row.length;) {
      let value = yield* byte(), count = 1;
      if (encoding === 1 && value >= 192) {
        count = value & 63;
        if (!count || count > row.length - i) throw new Error("Invalid PCX run length");
        value = yield* byte();
      }
      row.fill(value, i, i + count); i += count;
    }
    for (let x = 0; x < width; x += 1024) {
      const count = Math.min(1024, width - x), pixels = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        pixels[i * 4] = row[x + i]!;
        pixels[i * 4 + 1] = row[stride + x + i]!;
        pixels[i * 4 + 2] = row[stride * 2 + x + i]!;
        pixels[i * 4 + 3] = 255;
      }
      yield pixels;
    }
  }
}

export function decodePcxImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readPcxHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = pcxPixels(header);
  let step = steps.next(), offset = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(bytes[step.value]);
    else { data.set(step.value, offset); offset += step.value.length; step = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodePcxToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const header = readPcxHeader(await source.read(0, Math.min(128, source.size), { signal }), source.size), { metadata } = header;
  signal.throwIfAborted();
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), reader = new SourceBytes(source, signal, "PCX");
  const steps = pcxPixels(header);
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
