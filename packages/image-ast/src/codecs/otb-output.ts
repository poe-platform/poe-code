import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** Level-zero on-the-air bitmap: black is one, MSB first, with byte-padded rows. */
function* otbChunks(image: Pick<RgbaImage, "width" | "height">): Generator<number | Uint8Array, void, Uint8Array> {
  const { width, height } = image;
  if (!Number.isInteger(width) || width < 1 || width > 65535 || !Number.isInteger(height) || height < 1 || height > 65535) throw new RangeError("Invalid OTB dimensions");
  yield width > 255 || height > 255
    ? new Uint8Array([0x10, width >> 8, width & 255, height >> 8, height & 255, 1])
    : new Uint8Array([0, width, height, 1]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
    const data = yield (y * width + x) * 4;
    const bytes = new Uint8Array(Math.ceil(data.length / 32));
    for (let i = 0; i < data.length; i += 4) {
      if (0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]! < 127.5) bytes[Math.floor(i / 32)]! |= 0x80 >> (i / 4 % 8);
    }
    yield bytes;
  }
}

export function encodeOtbImage(image: RgbaImage): Uint8Array {
  const steps = otbChunks(image), chunks: Uint8Array[] = [];
  let step = steps.next(), size = 0;
  if (image.data.length !== image.width * image.height * 4) throw new Error("Invalid OTB pixels");
  while (!step.done) {
    if (typeof step.value === "number") {
      const length = Math.min(1024, image.width - (step.value / 4) % image.width) * 4;
      step = steps.next(image.data.subarray(step.value, step.value + length));
    } else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function* encodeOtbFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const steps = otbChunks(image);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(1024, image.width - (step.value / 4) % image.width) * 4;
      const data = await storage.read(image.position + step.value, length, { signal });
      signal.throwIfAborted();
      if (data.length !== length) throw new Error("Truncated OTB pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
