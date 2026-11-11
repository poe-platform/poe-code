import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** Level-zero WBMP: variable-length dimensions, white=1, MSB-first padded rows. */
function* wbmpChunks(image: Pick<RgbaImage, "width" | "height">): Generator<number | Uint8Array, void, Uint8Array> {
  const header = [0, 0];
  for (let value of [image.width, image.height]) {
    const bytes = [value % 128];
    while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value % 128) | 128);
    header.push(...bytes);
  }
  yield Uint8Array.from(header);
  let byte = 0, bit = 0;
  for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
    const data = yield offset;
    const output = new Uint8Array(data.length / 4);
    let length = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]! >= 127.5) byte |= 1 << (7 - bit);
      bit++;
      if (bit === 8 || ((offset + i) / 4 + 1) % image.width === 0) {
        output[length++] = byte;
        byte = 0; bit = 0;
      }
    }
    if (length) yield output.subarray(0, length);
  }
}

export function encodeWbmpImage(image: RgbaImage): Uint8Array {
  const chunks: Uint8Array[] = [], steps = wbmpChunks(image);
  let step = steps.next(), size = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next(image.data.subarray(step.value, step.value + 4096));
    else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function* encodeWbmpFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const steps = wbmpChunks(image);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(4096, image.width * image.height * 4 - step.value);
      const data = await storage.read(image.position + step.value, length, { signal });
      if (data.length !== length) throw new Error("Truncated WBMP pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
