import { defaultRuntime } from "@poe-code/compression";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { netpbmFormat } from "./netpbm-format.js";

const blockSize = 2880;

function fitsHeader(width: number, height: number, channels: 1 | 3, depth: 8 | 16): Uint8Array {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * channels * (depth / 8) + blockSize * 2)) throw new Error("Invalid FITS dimensions");
  const cards: [string, string | number][] = [
    ["SIMPLE", "T"], ["BITPIX", depth], ["NAXIS", channels === 1 ? 2 : 3],
    ["NAXIS1", width], ["NAXIS2", height],
    ...(channels === 3 ? [["NAXIS3", 3] as [string, number]] : []),
    ["BSCALE", 1], ["BZERO", depth === 16 ? 32768 : 0],
    ["DATAMAX", depth === 16 ? 65535 : 255], ["DATAMIN", 0]
  ];
  return new TextEncoder().encode((cards.map(([key, value]) => `${key.padEnd(8)}= ${String(value).padStart(20)}`.padEnd(80)).join("") + "END".padEnd(80)).padEnd(blockSize));
}

function fitsSamples(samples: Uint8Array | Uint16Array, channel: number): Uint8Array {
  const depth = samples instanceof Uint16Array ? 16 : 8;
  const output = new Uint8Array(samples.length / 4 * (depth / 8));
  const view = new DataView(output.buffer);
  for (let pixel = 0; pixel < samples.length / 4; pixel++) {
    const sample = samples[pixel * 4 + channel]!;
    if (depth === 16) view.setInt16(pixel * 2, sample - 32768);
    else output[pixel] = sample;
  }
  return output;
}

export function encodeFitsImage(image: RgbaImage): { data: Uint8Array; format: "fits"; channels: 1 | 3 } {
  const samples = image.data16 ?? image.data;
  const depth = image.data16 ? 16 : 8;
  const channels = netpbmFormat(samples) === "ppm" ? 3 : 1;
  const header = fitsHeader(image.width, image.height, channels, depth);
  const size = image.width * image.height * channels * (depth / 8);
  const data = new Uint8Array(blockSize + Math.ceil(size / blockSize) * blockSize);
  data.set(header);
  let offset = blockSize;
  for (let channel = 0; channel < channels; channel++) for (let y = image.height - 1; y >= 0; y--) {
    const row = fitsSamples(samples.subarray(y * image.width * 4, (y + 1) * image.width * 4), channel);
    data.set(row, offset);
    offset += row.length;
  }
  return { data, format: "fits", channels };
}

export async function* encodeFitsFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, channels: 1 | 3): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const sampleBytes = image.storedData16 ? 2 : 1;
  const position = image.storedData16?.position ?? image.position;
  yield fitsHeader(image.width, image.height, channels, sampleBytes === 2 ? 16 : 8);
  for (let channel = 0; channel < channels; channel++) for (let y = image.height - 1; y >= 0; y--) for (let x = 0; x < image.width; x += 512) {
    await defaultRuntime.yieldTurn(signal);
    const length = Math.min(512, image.width - x) * 4 * sampleBytes;
    const bytes = await storage.read(position + (y * image.width + x) * 4 * sampleBytes, length, { signal });
    if (bytes.length !== length) throw new Error("Truncated FITS sample storage");
    yield fitsSamples(image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes, channel);
  }
  const remainder = image.width * image.height * channels * sampleBytes % blockSize;
  if (remainder) yield new Uint8Array(blockSize - remainder);
}
