import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

export function isSgiBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 1 && bytes[1] === 218;
}

export function readSgiHeader(bytes: Uint8Array, size = bytes.length) {
  if (!isSgiBytes(bytes) || bytes.length < 108 || size < 512) throw new Error("Invalid SGI header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const encoding = bytes[2]!, dimension = view.getUint16(4);
  const width = view.getUint16(6), height = view.getUint16(8), channels = view.getUint16(10);
  if (!width || !height || dimension < 1 || dimension > 3) throw new Error("Invalid SGI dimensions");
  if (encoding > 1 || bytes[3] !== 1 || channels < 1 || channels > 4 || view.getUint32(104) !== 0) {
    throw new Error("Unsupported SGI pixel layout");
  }
  if (size < 512 + (encoding ? height * channels * 8 : width * height * channels)) throw new Error("Truncated SGI pixels or row tables");
  const metadata: ImageMetadata = { format: "sgi", width, height, channels: channels as 1 | 2 | 3 | 4,
    space: channels < 3 ? "b-w" : "srgb", depth: "uchar", density: 72, hasAlpha: channels === 2 || channels === 4, size };
  return { metadata, encoding, size };
}

// Rows are stored bottom-up in separate channel planes. RLE tables address each row independently.
function* sgiRows(header: ReturnType<typeof readSgiHeader>): Generator<number | { offset: number; data: Uint8Array }, void, number | undefined> {
  const { metadata: { width, height, channels }, encoding, size } = header;
  function* byte(offset: number): Generator<number, number, number | undefined> {
    if (offset >= size) throw new Error("Truncated SGI pixels");
    const value = yield offset;
    if (value === undefined) throw new Error("Truncated SGI pixels");
    return value;
  }
  function* uint32(offset: number): Generator<number, number, number | undefined> {
    let value = 0;
    for (let i = 0; i < 4; i++) value = value * 256 + (yield* byte(offset + i));
    return value;
  }
  const row = new Uint8Array(width * channels);
  for (let y = 0; y < height; y++) {
    for (let channel = 0; channel < channels; channel++) {
      const index = channel * height + y, start = channel * width;
      if (!encoding) {
        for (let x = 0; x < width; x++) row[start + x] = yield* byte(512 + index * width + x);
        continue;
      }
      let offset = yield* uint32(512 + index * 4);
      const length = yield* uint32(512 + height * channels * 4 + index * 4), end = offset + length;
      if (offset < 512 + height * channels * 8 || !length || end > size) throw new Error("Invalid SGI row range");
      let x = 0, terminated = false;
      while (offset < end) {
        const packet = yield* byte(offset++), count = packet & 127;
        if (!count) { terminated = true; break; }
        if (count > width - x) throw new Error("Invalid SGI run length");
        const literal = (packet & 128) !== 0;
        if (offset + (literal ? count : 1) > end) throw new Error("Truncated SGI run");
        if (literal) {
          for (let i = 0; i < count; i++) row[start + x++] = yield* byte(offset++);
        } else {
          row.fill(yield* byte(offset++), start + x, start + x + count); x += count;
        }
      }
      if (!terminated || x !== width) throw new Error("Invalid SGI row length or terminator");
    }
    for (let x = 0; x < width; x += 1024) {
      const count = Math.min(1024, width - x), data = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        data[i * 4] = row[x + i]!;
        data[i * 4 + 1] = row[(channels < 3 ? 0 : width) + x + i]!;
        data[i * 4 + 2] = row[(channels < 3 ? 0 : width * 2) + x + i]!;
        data[i * 4 + 3] = header.metadata.hasAlpha ? row[(channels - 1) * width + x + i]! : 255;
      }
      yield { offset: ((height - 1 - y) * width + x) * 4, data };
    }
  }
}

export function decodeSgiImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const header = readSgiHeader(bytes), { metadata } = header;
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = sgiRows(header);
  let step = steps.next();
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(bytes[step.value]);
    else { data.set(step.value.data, step.value.offset); step = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodeSgiToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const header = readSgiHeader(await source.read(0, Math.min(108, source.size), { signal }), source.size), { metadata } = header;
  signal.throwIfAborted();
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), reader = new SourceBytes(source, signal, "SGI");
  const steps = sgiRows(header);
  let step = steps.next();
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(await reader.at(step.value));
    else {
      signal.throwIfAborted();
      await storage.write(position + step.value.offset, step.value.data, { signal });
      step = steps.next();
    }
  }
  return { ...metadata, position };
}
