import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

function* xbmChunks(image: Pick<RgbaImage, "width" | "height">): Generator<number | Uint8Array, void, Uint8Array> {
  const encoder = new TextEncoder();
  yield encoder.encode(`#define image_width ${image.width}\n#define image_height ${image.height}\nstatic unsigned char image_bits[] = {\n`);
  let byte = 0, bit = 0, first = true;
  for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
    const data = yield offset;
    let text = "";
    for (let i = 0; i < data.length; i += 4) {
      if (0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]! < 127.5) byte |= 1 << bit;
      bit++;
      if (bit === 8 || ((offset + i) / 4 + 1) % image.width === 0) {
        text += `${first ? " " : ", "}0x${byte.toString(16).padStart(2, "0")}`;
        first = false; byte = 0; bit = 0;
      }
    }
    yield encoder.encode(text);
  }
  yield encoder.encode(" };\n");
}

export function encodeXbmImage(image: RgbaImage): Uint8Array {
  const chunks: Uint8Array[] = [], steps = xbmChunks(image);
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

export async function* encodeXbmFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const steps = xbmChunks(image);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(4096, image.width * image.height * 4 - step.value);
      const data = await storage.read(image.position + step.value, length, { signal });
      if (data.length !== length) throw new Error("Truncated XBM pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
