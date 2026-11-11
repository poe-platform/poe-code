import { defaultRuntime } from "@poe-code/compression";
import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

export function isFitsBytes(bytes: Uint8Array): boolean {
  return "SIMPLE  =".split("").every((char, index) => bytes[index] === char.charCodeAt(0));
}

function* fitsHeader(size: number): Generator<number, { metadata: ImageMetadata; offset: number }, number | undefined> {
  const values = new Map<string, string>();
  let offset = 0;
  while (true) {
    if (offset + 80 > size) throw new Error("Truncated FITS header");
    let card = "";
    for (let i = 0; i < 80; i++) {
      const byte = yield offset++;
      if (byte === undefined) throw new Error("Truncated FITS header");
      card += String.fromCharCode(byte);
    }
    const key = card.slice(0, 8).trim();
    if (key === "END") break;
    if (card[8] === "=" && ["SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "BSCALE", "BZERO"].includes(key)) {
      values.set(key, card.slice(10).split("/")[0]!.trim());
    }
  }
  if (values.get("SIMPLE") !== "T" || Number(values.get("BITPIX")) !== 8 || Number(values.get("NAXIS")) !== 2 ||
      Number(values.get("BSCALE") ?? 1) !== 1 || Number(values.get("BZERO") ?? 0) !== 0) throw new Error("Unsupported FITS primary image layout");
  const width = Number(values.get("NAXIS1")), height = Number(values.get("NAXIS2"));
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid FITS dimensions");
  offset = Math.ceil(offset / 2880) * 2880;
  if (size - offset < width * height) throw new Error("Truncated FITS raster");
  return { metadata: { format: "fits", width, height, channels: 1, depth: "uchar", space: "b-w", hasAlpha: false, density: 72, bitsPerSample: 8, size }, offset };
}

export function readFitsHeader(bytes: Uint8Array) {
  const steps = fitsHeader(bytes.length); let next = steps.next();
  while (!next.done) next = steps.next(bytes[next.value]);
  return next.value;
}

export async function readFitsFromSource(source: ImageByteSource, signal: AbortSignal) {
  const reader = new SourceBytes(source, signal, "FITS"), steps = fitsHeader(source.size); let next = steps.next();
  while (!next.done) next = steps.next(await reader.at(next.value));
  return next.value;
}

function fitsPixels(bytes: Uint8Array): Uint8Array {
  const data = new Uint8Array(bytes.length * 4);
  for (let i = 0; i < bytes.length; i++) {
    data.fill(bytes[i]!, i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  return data;
}

export function decodeFitsImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const { metadata, offset } = readFitsHeader(bytes), { width, height } = metadata;
  checkLimitInputPixels(width, height, options);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = offset + (height - 1 - y) * width;
    data.set(fitsPixels(bytes.subarray(start, start + width)), y * width * 4);
  }
  return { ...metadata, data };
}

export async function decodeFitsToStorage(source: ImageByteSource, storage: ImageByteStorage, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const { metadata, offset } = await readFitsFromSource(source, signal), { width, height } = metadata;
  checkLimitInputPixels(width, height, options);
  const position = storage.allocate(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x += 1024) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    const count = Math.min(1024, width - x), bytes = await source.read(offset + (height - 1 - y) * width + x, count, { signal });
    if (bytes.length !== count) throw new Error("Truncated FITS raster");
    await storage.write(position + (y * width + x) * 4, fitsPixels(bytes), { signal });
  }
  return { ...metadata, position };
}
