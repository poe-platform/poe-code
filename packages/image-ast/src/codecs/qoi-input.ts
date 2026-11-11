import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";
import { defaultRuntime } from "@poe-code/compression";

export function isQoiBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 113 && bytes[1] === 111 && bytes[2] === 105 && bytes[3] === 102;
}

export function readQoiMetadata(bytes: Uint8Array): ImageMetadata & { magickColorspace?: "RGB" } {
  if (!isQoiBytes(bytes) || bytes.length < 14) throw new Error("Invalid QOI header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4), height = view.getUint32(8), channels = bytes[12];
  if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid QOI dimensions");
  if ((channels !== 3 && channels !== 4) || bytes[13]! > 1) throw new Error("Invalid QOI header");
  return { format: "qoi", width, height, channels, space: "srgb", ...(bytes[13] === 1 ? { magickColorspace: "RGB" as const, gamma: 1 } : {}), depth: "uchar", hasAlpha: channels === 4, density: 72, size: bytes.length };
}

// Share opcode handling across buffered and retained sources, emitting bounded pixel blocks.
function* qoiPixels(count: number, size: number): Generator<number | Uint8Array, void, number | undefined> {
  let offset = 14, r = 0, g = 0, b = 0, a = 255, run = 0;
  const index = new Uint8Array(64 * 4);
  function* byte(): Generator<number, number, number | undefined> {
    if (offset >= size - 8) throw new Error("Truncated QOI pixels");
    const value = yield offset++;
    if (value === undefined) throw new Error("Truncated QOI pixels");
    return value;
  }
  for (let start = 0; start < count; start += 1024) {
    const pixels = new Uint8Array(Math.min(1024, count - start) * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      if (run) run--;
      else {
        const op = yield* byte();
        if (op === 254 || op === 255) {
          r = yield* byte(); g = yield* byte(); b = yield* byte();
          if (op === 255) a = yield* byte();
        } else if ((op & 192) === 0) {
          const slot = op * 4;
          r = index[slot]!; g = index[slot + 1]!; b = index[slot + 2]!; a = index[slot + 3]!;
        } else if ((op & 192) === 64) {
          r = (r + ((op >> 4) & 3) - 2) & 255;
          g = (g + ((op >> 2) & 3) - 2) & 255;
          b = (b + (op & 3) - 2) & 255;
        } else if ((op & 192) === 128) {
          const next = yield* byte(), dg = (op & 63) - 32;
          r = (r + dg + (next >> 4) - 8) & 255;
          g = (g + dg) & 255;
          b = (b + dg + (next & 15) - 8) & 255;
        } else {
          run = op & 63;
          if (run >= count - start - i / 4) throw new Error("Invalid QOI run");
        }
        const slot = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4;
        index.set([r, g, b, a], slot);
      }
      pixels.set([r, g, b, a], i);
    }
    yield pixels;
  }
  for (let i = 0; i < 8; i++) if ((yield offset++) !== (i === 7 ? 1 : 0)) throw new Error("Invalid QOI end marker");
}

export function decodeQoiImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const metadata = readQoiMetadata(bytes);
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const data = new Uint8Array(metadata.width * metadata.height * 4), steps = qoiPixels(metadata.width * metadata.height, bytes.length);
  let step = steps.next(), offset = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(bytes[step.value]);
    else { data.set(step.value, offset); offset += step.value.length; step = steps.next(); }
  }
  return { ...metadata, data };
}

export async function decodeQoiToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  signal.throwIfAborted();
  const metadata = readQoiMetadata(await source.read(0, Math.min(14, source.size), { signal }));
  checkLimitInputPixels(metadata.width, metadata.height, options);
  const position = storage.allocate(metadata.width * metadata.height * 4), reader = new SourceBytes(source, signal, "QOI");
  const steps = qoiPixels(metadata.width * metadata.height, source.size);
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
