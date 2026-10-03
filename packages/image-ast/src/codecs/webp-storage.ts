import type { StoredRgbaImage, ImageByteStorage } from "./png-storage.js";
import { Pixels } from "../ops/storage-raster.js";
import { defaultRuntime } from "@poe-code/compression";
import { createWebpEncoder } from "./webp.js";
/** Pull-driven RIFF output; alpha admission scans bounded caller-backed pages. */
export async function* encodeWebpFromStorage(
  image: StoredRgbaImage,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options?: Parameters<typeof createWebpEncoder>[2]
) {
  signal.throwIfAborted();
  const length = image.width * image.height * 4;
  if (
    !Number.isSafeInteger(image.width) ||
    image.width <= 0 ||
    !Number.isSafeInteger(image.height) ||
    image.height <= 0 ||
    !Number.isSafeInteger(image.position) ||
    image.position < 0 ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(image.position + length)
  )
    throw new RangeError("Invalid WebP backing allocation");
  const pixels = new Pixels(image, storage, signal);
  let hasAlpha = false;
  for (let at = 0; at < length && !hasAlpha; at += 4096) {
    const bytes = await pixels.read(at, Math.min(4096, length - at));
    for (let i = 3; i < bytes.length; i += 4)
      if (bytes[i]! < 255) {
        hasAlpha = true;
        break;
      }
    if (at % 65536 === 0) await defaultRuntime.yieldTurn(signal);
  }
  const encoder = createWebpEncoder(image, hasAlpha, options);
  signal.throwIfAborted();
  yield encoder.header;
  for (let at = 0; at < length; at += 4092) {
    const bytes = await pixels.read(at, Math.min(4092, length - at));
    signal.throwIfAborted();
    yield encoder.pixels(bytes);
    if (at % (4092 * 16) === 0) await defaultRuntime.yieldTurn(signal);
  }
  signal.throwIfAborted();
  yield encoder.finish();
}
