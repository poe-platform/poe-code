import { assembleLossyWebp, encodeLossyWebp } from "./webp-lossy.js";
import type { StoredRgbaImage, ImageByteStorage } from "./png-storage.js";
import { Pixels } from "../ops/storage-raster.js";
import { defaultRuntime } from "@poe-code/compression";
import { createWebpAnimation, createWebpEncoder } from "./webp.js";
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
    image.width > 16384 ||
    !Number.isSafeInteger(image.height) ||
    image.height <= 0 ||
    (options?.pageHeight ?? image.pageHeight ?? image.height) > 16384 ||
    !Number.isSafeInteger(image.position) ||
    image.position < 0 ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(image.position + length)
  )
    throw new RangeError("Invalid WebP backing allocation");
  const pixels = new Pixels(image, storage, signal);
  if (options?.lossless === false) {
    const height = options.pageHeight ?? image.pageHeight ?? image.height;
    if (!Number.isInteger(height) || height <= 0 || height > 16383 || image.height % height !== 0 || image.width > 16383)
      throw new RangeError("Invalid lossy WebP dimensions");
    const frameLength = image.width * height * 4;
    const frames: Uint8Array[] = [], delays: number[] = [];
    for (let frame = 0; frame < image.height / height; frame++) {
      const data = new Uint8Array(frameLength);
      for (let at = 0; at < frameLength; at += 4096) {
        data.set(await pixels.read(frame * frameLength + at, Math.min(4096, frameLength - at)), at);
        if (at % 65536 === 0) await defaultRuntime.yieldTurn(signal);
      }
      signal.throwIfAborted();
      frames.push(encodeLossyWebp({ width: image.width, height, data }, { alphaQuality: options.alphaQuality ?? 100, quality: options.quality ?? 80, effort: options.effort ?? 4 }));
      delays.push(typeof options.delay === "number" ? options.delay : options.delay?.[frame] ?? await image.storedDelay?.at(frame, { signal }) ?? image.delay?.[frame] ?? 0);
    }
    const bytes = assembleLossyWebp(image, frames, height, delays, options);
    for (let at = 0; at < bytes.length; at += 4096) {
      signal.throwIfAborted();
      yield bytes.slice(at, at + 4096);
      if (at % 65536 === 0) await defaultRuntime.yieldTurn(signal);
    }
    return;
  }
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
  const animation = createWebpAnimation(image, hasAlpha, options);
  if (animation) yield animation.header;
  const frameLength = image.width * (animation?.height ?? image.height) * 4;
  for (let frame = 0; frame < (animation?.pages ?? 1); frame++) {
    const delay = typeof options?.delay === "number" ? options.delay : options?.delay?.[frame] ?? await image.storedDelay?.at(frame, { signal }) ?? image.delay?.[frame] ?? 0;
    const encoder = animation ? animation.frame(delay) : createWebpEncoder(image, hasAlpha, options);
    signal.throwIfAborted();
    yield encoder.header;
    for (let at = 0; at < frameLength; at += 4092) {
      const bytes = await pixels.read(frame * frameLength + at, Math.min(4092, frameLength - at));
      signal.throwIfAborted();
      yield encoder.pixels(bytes);
      if (at % (4092 * 16) === 0) await defaultRuntime.yieldTurn(signal);
    }
    signal.throwIfAborted();
    yield encoder.finish();
  }
  if (animation) yield animation.tail;
}
