import { decodeImage, readExrHeader } from "@poe-code/image-ast/portable";
import { scaleVideoPicture } from "@poe-code/media-codecs";
import { MediaBudgetTracker, type ParseMediaOptions } from "../types.js";

/** Preserve linear EXR samples and use FFmpeg's float-to-RGBA conversion. */
export function decodeExr(bytes: Uint8Array, options?: ParseMediaOptions) {
  const { metadata: { width, height, hasAlpha } } = readExrHeader(bytes);
  const budget = options?.budget ?? new MediaBudgetTracker(options?.limits);
  budget.recordFrame(width, height);
  // RGBA8/16/float decode buffers and scanline scratch, planar floats, and converted RGBA.
  budget.allocateMemory(width * height * 76);
  const image = decodeImage(bytes);
  const channels = hasAlpha ? [1, 2, 0, 3] : [1, 2, 0];
  const pixels = new Uint8Array(width * height * channels.length * 4);
  const view = new DataView(pixels.buffer);
  for (let plane = 0; plane < channels.length; plane++) {
    for (let pixel = 0; pixel < width * height; pixel++) {
      if (pixel % 4096 === 0) budget.checkCpu();
      view.setFloat32((plane * width * height + pixel) * 4, image.dataFloat![pixel * 4 + channels[plane]!]!, true);
    }
  }
  const native = { rgba: image.data, pixels, width, height,
    format: hasAlpha ? 177 : 175, colorspace: 5, fullRange: 1 };
  const data = scaleVideoPicture({ ...image, native }, width, height)!;
  return { ...image, data, native: { ...native, rgba: data } };
}
