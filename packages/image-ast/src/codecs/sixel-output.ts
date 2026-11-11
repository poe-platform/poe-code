import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";
import { GifPalette } from "./gif-output-parts.js";

/** Six-row color planes, tiled horizontally to bound both reads and working memory. */
function* sixelChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">): Generator<Uint8Array | { position: number; length: number }, void, Uint8Array> {
  const { width, height } = image;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) {
    throw new RangeError("Invalid SIXEL dimensions");
  }
  const encoder = new TextEncoder(), palette = new GifPalette();
  for (let position = 0; position < width * height * 4; position += 4096) {
    const data = yield { position, length: Math.min(4096, width * height * 4 - position) };
    for (let i = 0; i < data.length; i += 4) palette.add(data[i]!, data[i + 1]!, data[i + 2]!, image.hasAlpha ? data[i + 3]! : 255);
  }
  const colors = palette.finishPng();
  yield encoder.encode(`\x1bP0;1;0q"1;1;${width};${height}`);
  for (let i = 0; i < colors.bytes.length; i += 3) {
    yield encoder.encode(`#${i / 3};2;${Math.round(colors.bytes[i]! * 100 / 255)};${Math.round(colors.bytes[i + 1]! * 100 / 255)};${Math.round(colors.bytes[i + 2]! * 100 / 255)}`);
  }
  for (let y = 0; y < height; y += 6) {
    if (y) yield encoder.encode("-");
    for (let x = 0; x < width; x += 1024) {
      const length = Math.min(1024, width - x), planes = new Map<number, Uint8Array>();
      for (let row = 0; row < Math.min(6, height - y); row++) {
        const data = yield { position: ((y + row) * width + x) * 4, length: length * 4 };
        for (let column = 0; column < length; column++) {
          const i = column * 4;
          if (image.hasAlpha && data[i + 3]! < 128) continue;
          const index = colors.indices[palette.index(data[i]!, data[i + 1]!, data[i + 2]!, 255)]!;
          let plane = planes.get(index);
          if (!plane) { plane = new Uint8Array(length); planes.set(index, plane); }
          plane[column]! |= 1 << row;
        }
      }
      for (const [index, plane] of planes) {
        let text = `$#${index}${x ? `!${x}?` : ""}`;
        let end = plane.length;
        while (end > 0 && plane[end - 1] === 0) end--;
        for (let i = 0; i < end;) {
          let next = i + 1;
          while (next < end && plane[next] === plane[i]) next++;
          const count = next - i, symbol = String.fromCharCode(63 + plane[i]!);
          text += count > 3 ? `!${count}${symbol}` : symbol.repeat(count);
          i = next;
        }
        yield encoder.encode(text);
      }
    }
  }
  yield encoder.encode("\x1b\\");
}

export function encodeSixelImage(image: RgbaImage): Uint8Array {
  const chunks: Uint8Array[] = [], steps = sixelChunks(image);
  let step = steps.next(), size = 0;
  while (!step.done) {
    if (step.value instanceof Uint8Array) { chunks.push(step.value); size += step.value.length; step = steps.next(); }
    else {
      const { position, length } = step.value, data = image.data.subarray(position, position + length);
      if (data.length !== length) throw new Error("Truncated SIXEL pixel storage");
      step = steps.next(data);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function* encodeSixelFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const steps = sixelChunks(image);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (step.value instanceof Uint8Array) { yield step.value; step = steps.next(); }
    else {
      const { position, length } = step.value;
      const data = await storage.read(image.position + position, length, { signal });
      if (data.length !== length) throw new Error("Truncated SIXEL pixel storage");
      step = steps.next(data);
    }
  }
}
