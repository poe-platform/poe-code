import type { StoredRgbaImage, ImageByteStorage } from "./png-storage.js";
import { Pixels } from "../ops/storage-raster.js";
import { createJpegEncoder } from "./jpeg.js";
export async function* encodeJpegFromStorage(
  image: StoredRgbaImage,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options?: Parameters<typeof createJpegEncoder>[1]
) {
  signal.throwIfAborted();
  const encoder = createJpegEncoder(image, options),
    { width, height, position } = image;
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(position + width * height * 4)
  )
    throw new RangeError("Invalid JPEG backing allocation");
  yield encoder.header;
  const pixels = new Pixels(image, storage, signal),
    block = new Uint8Array(encoder.blockWidth * encoder.blockHeight * 4);
  for (let by = 0; by < height; by += encoder.blockHeight)
    for (let bx = 0; bx < width; bx += encoder.blockWidth) {
      for (let y = 0; y < encoder.blockHeight; y++)
        for (let x = 0; x < encoder.blockWidth; x++) {
          const p = await pixels.pixel(
              Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x)
            ),
            at = (y * encoder.blockWidth + x) * 4;
          block[at] = p & 255;
          block[at + 1] = (p >>> 8) & 255;
          block[at + 2] = (p >>> 16) & 255;
          block[at + 3] = p >>> 24;
        }
      signal.throwIfAborted();
      const chunk = encoder.block(block);
      if (chunk.length) yield chunk;
    }
  signal.throwIfAborted();
  yield encoder.finish();
}
