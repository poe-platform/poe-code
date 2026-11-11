import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** QOI RGB/RGBA literal opcodes preserve every sample, including transparent RGB. */
function* qoiChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha"> & { magickColorspace?: string }): Generator<number | Uint8Array, void, Uint8Array> {
  const header = new Uint8Array(14);
  header.set([113, 111, 105, 102]);
  const view = new DataView(header.buffer);
  view.setUint32(4, image.width);
  view.setUint32(8, image.height);
  header[12] = image.hasAlpha ? 4 : 3;
  header[13] = image.magickColorspace === "RGB" ? 1 : 0;
  yield header;
  let alpha = 255;
  for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
    const data = yield offset;
    const output = new Uint8Array(data.length / 4 * 5);
    let length = 0;
    for (let i = 0; i < data.length; i += 4) {
      const nextAlpha = image.hasAlpha ? data[i + 3]! : 255;
      output[length++] = nextAlpha === alpha ? 254 : 255;
      output[length++] = data[i]!;
      output[length++] = data[i + 1]!;
      output[length++] = data[i + 2]!;
      if (nextAlpha !== alpha) output[length++] = nextAlpha;
      alpha = nextAlpha;
    }
    yield output.subarray(0, length);
  }
  yield new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);
}

export function encodeQoiImage(image: RgbaImage): Uint8Array {
  const chunks: Uint8Array[] = [], steps = qoiChunks(image);
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

export async function* encodeQoiFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const steps = qoiChunks(image);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(4096, image.width * image.height * 4 - step.value);
      const data = await storage.read(image.position + step.value, length, { signal });
      if (data.length !== length) throw new Error("Truncated QOI pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
