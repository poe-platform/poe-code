import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { Pixels } from "../ops/storage-raster.js";
import {
  GifCodes,
  GifPalette,
  gifLayout,
  gifHeader,
  gifFrameHeader,
  type GifOptions
} from "./gif-output-parts.js";
/** Multipass GIF encoding with a fixed palette and pull-driven owned subblocks. */
export async function* encodeGifFromStorage(
  image: StoredRgbaImage,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options: GifOptions = {}
) {
  signal.throwIfAborted();
  const layout = gifLayout(image, options),
    length = image.width * image.height * 4;
  if (
    !Number.isSafeInteger(image.position) ||
    image.position < 0 ||
    !Number.isSafeInteger(image.position + length)
  )
    throw new RangeError("Invalid GIF backing allocation");
  const pixels = new Pixels(image, storage, signal),
    palette = new GifPalette();
  for (let i = 0; i < length / 4; i++) {
    const p = await pixels.pixel(i);
    palette.add(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, p >>> 24);
  }
  palette.finish();
  signal.throwIfAborted();
  yield gifHeader(image, options, layout, palette);
  for (let frame = 0; frame < layout.frames; frame++) {
    const start = frame * layout.framePixels;
    let transparent = false;
    for (let i = 0; i < layout.framePixels; i++)
      if ((await pixels.pixel(start + i)) >>> 24 < 128) {
        transparent = true;
        break;
      }
    signal.throwIfAborted();
    const frameDelay = options.delay === undefined
      ? await image.storedDelay?.at(frame, {signal})
      : undefined;
    signal.throwIfAborted();
    yield gifFrameHeader(image, options, layout, frame, transparent, frameDelay);
    const codes = new GifCodes();
    codes.code(256);
    for (let i = 0; i < layout.framePixels; i++) {
      if (i > 0 && i % 120 === 0) {
        const chunk = codes.code(256);
        if (chunk) {
          signal.throwIfAborted();
          yield chunk;
        }
      }
      const p = await pixels.pixel(start + i),
        chunk = codes.code(palette.index(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, p >>> 24));
      if (chunk) {
        signal.throwIfAborted();
        yield chunk;
      }
    }
    for (const chunk of codes.finish()) {
      signal.throwIfAborted();
      yield chunk;
    }
  }
  signal.throwIfAborted();
  yield Uint8Array.of(59);
}
