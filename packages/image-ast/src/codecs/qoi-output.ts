import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** Compact QOI opcodes preserve every sample, including transparent RGB. */
function* qoiChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha"> & { magickColorspace?: string }): Generator<number | Uint8Array, void, Uint8Array> {
  const header = new Uint8Array(14);
  header.set([113, 111, 105, 102]);
  const view = new DataView(header.buffer);
  view.setUint32(4, image.width);
  view.setUint32(8, image.height);
  header[12] = image.hasAlpha ? 4 : 3;
  header[13] = image.magickColorspace === "RGB" ? 1 : 0;
  yield header;
  let red = 0, green = 0, blue = 0, alpha = 255, run = 0;
  for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
    const data = yield offset;
    const output = new Uint8Array(data.length / 4 * 5 + 1);
    let length = 0;
    for (let i = 0; i < data.length; i += 4) {
      const nextRed = data[i]!, nextGreen = data[i + 1]!, nextBlue = data[i + 2]!;
      const nextAlpha = image.hasAlpha ? data[i + 3]! : 255;
      if (nextRed === red && nextGreen === green && nextBlue === blue && nextAlpha === alpha) {
        run++;
        if (run === 62) { output[length++] = 192 | (run - 1); run = 0; }
        continue;
      }
      if (run) { output[length++] = 192 | (run - 1); run = 0; }
      // QOI differences wrap at the byte boundary.
      const dr = ((nextRed - red + 128) & 255) - 128;
      const dg = ((nextGreen - green + 128) & 255) - 128;
      const db = ((nextBlue - blue + 128) & 255) - 128;
      const drdg = dr - dg, dbdg = db - dg;
      if (nextAlpha === alpha && dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
        output[length++] = 64 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2);
      } else if (nextAlpha === alpha && dg >= -32 && dg <= 31 && drdg >= -8 && drdg <= 7 && dbdg >= -8 && dbdg <= 7) {
        output[length++] = 128 | (dg + 32);
        output[length++] = ((drdg + 8) << 4) | (dbdg + 8);
      } else {
        output[length++] = nextAlpha === alpha ? 254 : 255;
        output[length++] = nextRed;
        output[length++] = nextGreen;
        output[length++] = nextBlue;
        if (nextAlpha !== alpha) output[length++] = nextAlpha;
      }
      red = nextRed; green = nextGreen; blue = nextBlue; alpha = nextAlpha;
    }
    yield output.subarray(0, length);
  }
  if (run) yield new Uint8Array([192 | (run - 1)]);
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
