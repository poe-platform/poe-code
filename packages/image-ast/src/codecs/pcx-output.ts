import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

/** Version-5 PCX with three 8-bit RGB planes and even scanline lengths. */
function* pcxChunks(image: Pick<RgbaImage, "width" | "height" | "resolution">, options: OutputEncodeOptions): Generator<number | Uint8Array, void, Uint8Array> {
  const { width, height, resolution } = image;
  if (!Number.isInteger(width) || width < 1 || width > 65534 || !Number.isInteger(height) || height < 1 || height > 65536) throw new RangeError("Invalid PCX dimensions");
  const header = new Uint8Array(128), view = new DataView(header.buffer);
  header.set([10, 5, 1, 8]);
  view.setUint16(8, width - 1, true);
  view.setUint16(10, height - 1, true);
  const scale = resolution?.unit === "cm" ? 2.54 : resolution?.unit === "meter" ? 0.0254 : 1;
  view.setUint16(12, Math.min(65535, Math.max(0, Math.round(options.density ?? (resolution?.x ?? 0) * scale))), true);
  view.setUint16(14, Math.min(65535, Math.max(0, Math.round(options.density ?? (resolution?.y ?? 0) * scale))), true);
  header[65] = 3;
  view.setUint16(66, width + width % 2, true);
  view.setUint16(68, 1, true);
  yield header;
  for (let y = 0; y < height; y++) for (let channel = 0; channel < 3; channel++) {
    for (let x = 0; x < width; x += 1024) {
      const data = yield (y * width + x) * 4;
      const pixels = data.length / 4;
      const count = pixels + (x + pixels === width ? width % 2 : 0);
      const output = new Uint8Array(count * 2);
      let size = 0;
      for (let index = 0; index < count;) {
        const value = index < pixels ? data[index * 4 + channel]! : 0;
        let run = 1;
        while (run < 63 && index + run < count && (index + run < pixels ? data[(index + run) * 4 + channel]! : 0) === value) run++;
        if (run > 1 || value >= 192) output[size++] = 192 | run;
        output[size++] = value;
        index += run;
      }
      yield output.subarray(0, size);
    }
  }
}

export function encodePcxImage(image: RgbaImage, options: OutputEncodeOptions): Uint8Array {
  const steps = pcxChunks(image, options), chunks: Uint8Array[] = [];
  let step = steps.next(), size = 0;
  if (image.data.length !== image.width * image.height * 4) throw new Error("Invalid PCX pixels");
  while (!step.done) {
    if (typeof step.value === "number") {
      const length = Math.min(1024, image.width - (step.value / 4) % image.width) * 4;
      step = steps.next(image.data.subarray(step.value, step.value + length));
    } else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
  }
  const output = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.length; }
  return output;
}

export async function* encodePcxFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const steps = pcxChunks(image, options);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(1024, image.width - (step.value / 4) % image.width) * 4;
      const data = await storage.read(image.position + step.value, length, { signal });
      signal.throwIfAborted();
      if (data.length !== length) throw new Error("Truncated PCX pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
