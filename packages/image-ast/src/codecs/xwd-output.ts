import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** Version-7 ZPixmap with 24-bit RGB pixels and 32-bit row alignment. */
function* xwdChunks(image: Pick<RgbaImage, "width" | "height">): Generator<number | Uint8Array, void, Uint8Array> {
  const { width, height } = image;
  const padding = (4 - width * 3 % 4) % 4;
  const header = new Uint8Array(101), view = new DataView(header.buffer);
  const fields = [
    header.length, 7, 2, 24, width, height, 0,
    1, 32, 1, 32, 24, width * 3 + padding, 4,
    0xff0000, 0xff00, 0xff, 8, 256, 0,
    width, height, 0, 0, 0
  ];
  fields.forEach((value, index) => view.setUint32(index * 4, value));
  yield header; // The fixed header is followed by an empty, NUL-terminated window name.
  for (let offset = 0; offset < width * height * 4; offset += 4096) {
    const data = yield offset;
    const first = offset / 4, count = data.length / 4;
    const rows = Math.floor((first + count) / width) - Math.floor(first / width);
    const bytes = new Uint8Array(count * 3 + rows * padding);
    let position = 0;
    for (let pixel = 0; pixel < count; pixel++) {
      bytes[position] = data[pixel * 4]!;
      bytes[position + 1] = data[pixel * 4 + 1]!;
      bytes[position + 2] = data[pixel * 4 + 2]!;
      position += 3;
      if ((first + pixel + 1) % width === 0) position += padding;
    }
    yield bytes;
  }
}

export function encodeXwdImage(image: RgbaImage): Uint8Array {
  const chunks: Uint8Array[] = [], steps = xwdChunks(image);
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

export async function* encodeXwdFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const steps = xwdChunks(image);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(4096, image.width * image.height * 4 - step.value);
      const data = await storage.read(image.position + step.value, length, { signal });
      if (data.length !== length) throw new Error("Truncated XWD pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
