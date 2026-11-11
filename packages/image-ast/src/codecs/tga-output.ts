import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

function tgaHeader(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "orientation">, rle: boolean): Uint8Array {
  if (![image.width, image.height].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new RangeError("Invalid TGA dimensions");
  const header = new Uint8Array(18), view = new DataView(header.buffer);
  header[2] = rle ? 10 : 2;
  view.setUint16(12, image.width, true);
  view.setUint16(14, image.height, true);
  header[16] = image.hasAlpha ? 32 : 24;
  const orientation = image.orientation ?? 0;
  const origin = orientation === 0 || orientation === 1 ? 0x20 : orientation === 2 ? 0x30 : orientation === 3 ? 0x10 : 0;
  header[17] = origin | (image.hasAlpha ? 8 : 0);
  return header;
}

/** Pack a bounded span in BGR(A) order; packets never cross a row. */
function tgaSpan(data: Uint8Array, alpha: boolean, rle: boolean): Uint8Array {
  const count = data.length / 4, stride = alpha ? 4 : 3;
  const output = new Uint8Array(count * stride + (rle ? count : 0));
  let offset = 0;
  const same = (a: number, b: number): boolean => {
    for (let channel = 0; channel < stride; channel++) if (data[a * 4 + channel] !== data[b * 4 + channel]) return false;
    return true;
  };
  const pixel = (index: number): void => {
    output[offset++] = data[index * 4 + 2]!;
    output[offset++] = data[index * 4 + 1]!;
    output[offset++] = data[index * 4]!;
    if (alpha) output[offset++] = data[index * 4 + 3]!;
  };
  for (let index = 0; index < count;) {
    if (!rle) { pixel(index++); continue; }
    let end = index + 1;
    if (end < count && same(index, end)) {
      while (end < count && end - index < 128 && same(index, end)) end++;
      output[offset++] = 0x80 | (end - index - 1);
      pixel(index);
    } else {
      while (end < count && end - index < 128 && !(end + 1 < count && same(end, end + 1))) end++;
      output[offset++] = end - index - 1;
      for (let raw = index; raw < end; raw++) pixel(raw);
    }
    index = end;
  }
  return output.subarray(0, offset);
}

export function encodeTgaImage(image: RgbaImage, options: OutputEncodeOptions): Uint8Array {
  const rle = options.tgaCompression === "rle", header = tgaHeader(image, rle);
  if (image.data.length !== image.width * image.height * 4) throw new Error("Invalid TGA pixels");
  const chunks = [header];
  let size = header.length;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x += 1024) {
      const start = (y * image.width + x) * 4;
      const chunk = tgaSpan(image.data.subarray(start, start + Math.min(1024, image.width - x) * 4), image.hasAlpha, rle);
      chunks.push(chunk); size += chunk.length;
    }
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function* encodeTgaFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const rle = options.tgaCompression === "rle";
  yield tgaHeader(image, rle);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x += 1024) {
      await defaultRuntime.yieldTurn(signal);
      const length = Math.min(1024, image.width - x) * 4;
      const data = await storage.read(image.position + (y * image.width + x) * 4, length, { signal });
      signal.throwIfAborted();
      if (data.length !== length) throw new Error("Truncated TGA pixel storage");
      yield tgaSpan(data, image.hasAlpha, rle);
    }
  }
}
