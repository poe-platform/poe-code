import type { OutputEncodeOptions, RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

function tgaHeader(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "orientation" | "properties">, rle: boolean): Uint8Array {
  if (![image.width, image.height].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new RangeError("Invalid TGA dimensions");
  // Keep a surrogate pair at the byte limit intact before UTF-8 truncation.
  const comment = (image.properties?.comment ?? "").slice(0, 256).split("\0", 1)[0];
  const id = new TextEncoder().encode(comment).subarray(0, 255);
  const header = new Uint8Array(18 + id.length), view = new DataView(header.buffer);
  header[0] = id.length;
  header.set(id, 18);
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
function tgaSpan(data: Uint8Array, stride: 3 | 4, rle: boolean, palette?: ReadonlyMap<number, number>): Uint8Array {
  const count = data.length / 4;
  const output = new Uint8Array(count * (palette ? 1 : stride) + (rle ? count : 0));
  let offset = 0;
  const same = (a: number, b: number): boolean => {
    for (let channel = 0; channel < stride; channel++) if (data[a * 4 + channel] !== data[b * 4 + channel]) return false;
    return true;
  };
  const pixel = (index: number): void => {
    if (palette) {
      const offsetIn = index * 4;
      const color = (data[offsetIn]! * 65536 + data[offsetIn + 1]! * 256 + data[offsetIn + 2]!) * 256 + (stride === 4 ? data[offsetIn + 3]! : 255);
      output[offset++] = palette.get(color)!;
      return;
    }
    output[offset++] = data[index * 4 + 2]!;
    output[offset++] = data[index * 4 + 1]!;
    output[offset++] = data[index * 4]!;
    if (stride === 4) output[offset++] = data[index * 4 + 3]!;
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

/** Scan palette sources before emitting the header, retaining at most 256 colors. */
function* tgaChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "channels" | "isPalette" | "orientation" | "properties">, options: OutputEncodeOptions): Generator<number | Uint8Array, void, Uint8Array> {
  const channels = image.hasAlpha ? 4 : 3, rle = options.tgaCompression === "rle", header = tgaHeader(image, rle);
  let palette = image.isPalette ? new Map<number, number>() : undefined;
  for (let offset = 0; palette && offset < image.width * image.height * 4; offset += Math.min(1024, image.width - offset / 4 % image.width) * 4) {
    const data = yield offset;
    for (let i = 0; i < data.length; i += 4) {
      const color = (data[i]! * 65536 + data[i + 1]! * 256 + data[i + 2]!) * 256 + (image.hasAlpha ? data[i + 3]! : 255);
      if (!palette.has(color)) {
        if (palette.size === 256) { palette = undefined; break; }
        palette.set(color, palette.size);
      }
    }
  }
  if (palette) {
    header[1] = 1;
    header[2] = rle ? 9 : 1;
    new DataView(header.buffer).setUint16(5, palette.size, true);
    header[7] = channels * 8;
    header[16] = 8;
    header[17] = header[17]! & 0xf0;
  }
  yield header;
  if (palette) {
    const colors = new Uint8Array(palette.size * channels);
    for (const [color, index] of palette) {
      colors.set([color >>> 8 & 255, color >>> 16 & 255, color >>> 24], index * channels);
      if (channels === 4) colors[index * channels + 3] = color & 255;
    }
    yield colors;
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x += 1024) {
      const start = (y * image.width + x) * 4;
      const data = yield start;
      yield tgaSpan(data.subarray(0, Math.min(1024, image.width - x) * 4), channels, rle, palette);
    }
  }
}

export function encodeTgaImage(image: RgbaImage, options: OutputEncodeOptions): Uint8Array {
  const steps = tgaChunks(image, options), chunks: Uint8Array[] = [];
  let next = steps.next(), size = 0;
  if (image.data.length !== image.width * image.height * 4) throw new Error("Invalid TGA pixels");
  while (!next.done) {
    if (typeof next.value === "number") next = steps.next(image.data.subarray(next.value, next.value + Math.min(1024, image.width - next.value / 4 % image.width) * 4));
    else { chunks.push(next.value); size += next.value.length; next = steps.next(); }
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function* encodeTgaFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, options: OutputEncodeOptions): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const steps = tgaChunks(image, options);
  let next = steps.next();
  while (!next.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof next.value === "number") {
      const length = Math.min(1024, image.width - next.value / 4 % image.width) * 4;
      const data = await storage.read(image.position + next.value, length, { signal });
      signal.throwIfAborted();
      if (data.length !== length) throw new Error("Truncated TGA pixel storage");
      next = steps.next(data);
    } else { yield next.value; next = steps.next(); }
  }
}
