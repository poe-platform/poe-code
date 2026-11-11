import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";

type Samples = Uint8Array | Uint16Array;

/** Uncompressed Palm bitmap, with word-aligned rows and MSB-first samples. */
function* palmChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">, highDepth: boolean): Generator<number | Uint8Array, void, Samples> {
  const { width, height } = image, maximum = highDepth ? 65535 : 255;
  if (!Number.isInteger(width) || width < 1 || width > 65535 || !Number.isInteger(height) || height < 1 || height > 65535) throw new RangeError("Invalid PALM dimensions");
  const colors = new Map<string, number[]>();
  const key = (data: Samples, offset: number) => `${data[offset]},${data[offset + 1]},${data[offset + 2]},${image.hasAlpha ? data[offset + 3] : maximum}`;
  const gray = (color: ArrayLike<number>, offset = 0) => Math.round((0.212656 * color[offset]! + 0.715158 * color[offset + 1]! + 0.072186 * color[offset + 2]!) * 65535 / maximum);
  let transparent: number[] | undefined;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 512) {
    const data = yield (y * width + x) * 4;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (colors.size <= 256) colors.set(key(data, offset), [data[offset]!, data[offset + 1]!, data[offset + 2]!]);
      if (image.hasAlpha && data[offset + 3] === 0) transparent = [data[offset]!, data[offset + 1]!, data[offset + 2]!];
    }
  }
  const depth = colors.size <= 2 ? 1 : colors.size <= 4 ? 2 : colors.size <= 16 ? 4 : colors.size <= 256 ? 8 : 16;
  const rowBytes = Math.ceil(width * depth / 16) * 2;
  if (rowBytes > 65535) throw new RangeError("Invalid PALM row size");
  const grays = depth < 8 ? [...new Set([...colors.values()].map(color => gray(color)))].sort((a, b) => b - a) : [];
  const indices = new Map([...colors.keys()].map((color, index) => [color, index]));
  const header = new Uint8Array(depth === 16 ? 24 : depth === 8 ? 18 + colors.size * 4 : 16), view = new DataView(header.buffer);
  view.setUint16(0, width); view.setUint16(2, height); view.setUint16(4, rowBytes);
  view.setUint16(6, depth === 16 ? 0x0400 | (transparent ? 0x2000 : 0) : 0x4000);
  header[8] = depth; header[9] = depth > 1 ? 1 : 0; header[13] = 0xff;
  if (depth === 16) {
    header.set([5, 6, 5, 0], 16);
    if (transparent) header.set(transparent.map((value, channel) => Math.floor(value * (channel === 1 ? 63 : 31) / maximum)), 21);
  } else if (depth === 8) {
    view.setUint16(16, colors.size);
    let offset = 18, index = 0;
    for (const color of colors.values()) {
      header.set([index++, ...color.map(value => Math.round(value * 255 / maximum))], offset);
      offset += 4;
    }
  }
  yield header;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 512) {
    const data = yield (y * width + x) * 4, count = data.length / 4;
    const length = x + count === width ? rowBytes - x * depth / 8 : count * depth / 8;
    const bytes = new Uint8Array(length);
    for (let pixel = 0; pixel < count; pixel++) {
      const offset = pixel * 4;
      if (depth === 16) {
        const value = Math.floor(data[offset]! * 31 / maximum) << 11 | Math.floor(data[offset + 1]! * 63 / maximum) << 5 | Math.floor(data[offset + 2]! * 31 / maximum);
        bytes[pixel * 2] = value >> 8; bytes[pixel * 2 + 1] = value & 255;
      } else {
        const value = depth === 8 ? indices.get(key(data, offset))! : Math.floor(grays.indexOf(gray(data, offset)) * ((1 << depth) - 1) / Math.max(1, grays.length - 1));
        bytes[Math.floor(pixel * depth / 8)]! |= value << (8 - depth - pixel * depth % 8);
      }
    }
    yield bytes;
  }
}

export function encodePalmImage(image: RgbaImage): Uint8Array {
  const samples = image.data16 ?? image.data;
  if (samples.length !== image.width * image.height * 4) throw new Error("Invalid PALM pixels");
  const steps = palmChunks(image, !!image.data16), chunks: Uint8Array[] = [];
  let step = steps.next(), size = 0;
  while (!step.done) {
    if (typeof step.value === "number") {
      const length = Math.min(512, image.width - step.value / 4 % image.width) * 4;
      step = steps.next(samples.subarray(step.value, step.value + length));
    } else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function* encodePalmFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const steps = palmChunks(image, !!image.storedData16), sampleBytes = image.storedData16 ? 2 : 1;
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(512, image.width - step.value / 4 % image.width) * 4 * sampleBytes;
      const bytes = await storage.read((image.storedData16?.position ?? image.position) + step.value * sampleBytes, length, { signal });
      signal.throwIfAborted();
      if (bytes.length !== length) throw new Error("Truncated PALM pixel storage");
      step = steps.next(image.storedData16 ? new Uint16Array(bytes.slice().buffer) : bytes);
    } else { yield step.value; step = steps.next(); }
  }
}
