/*!
 * Staged image reduction adapted from Mozilla PDF.js CanvasGraphics._scaleImage.
 * Copyright 2012 Mozilla Foundation. Licensed under Apache-2.0.
 * See THIRD_PARTY_NOTICES.md for the source revision and adaptations.
 */
import type { RgbaBitmap } from "./raster.js";

/** Canvas-style bilinear filtering in premultiplied alpha, with clamped edges. */
export function sampleImageLinear(image: RgbaBitmap, x: number, y: number, out: Float64Array): void {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  out.fill(0);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const offset = (Math.min(image.height - 1, y0 + j) * image.width + Math.min(image.width - 1, x0 + i)) * 4;
      const alpha = image.data[offset + 3]! * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      out[0] = out[0]! + image.data[offset]! * alpha;
      out[1] = out[1]! + image.data[offset + 1]! * alpha;
      out[2] = out[2]! + image.data[offset + 2]! * alpha;
      out[3] = out[3]! + alpha;
    }
  }
  if (out[3]! > 0) {
    out[0] = out[0]! / out[3]!;
    out[1] = out[1]! / out[3]!;
    out[2] = out[2]! / out[3]!;
  }
}

/** Reduce by at most two per axis per step, retaining only the current level. */
export function downscaleImage(image: RgbaBitmap, widthScale: number, heightScale: number): RgbaBitmap {
  const sample = new Float64Array(4);
  while ((widthScale > 2 && image.width > 1) || (heightScale > 2 && image.height > 1)) {
    const width = widthScale > 2 ? Math.ceil(image.width / 2) : image.width;
    const height = heightScale > 2 ? Math.ceil(image.height / 2) : image.height;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        sampleImageLinear(image, (x + 0.5) * image.width / width - 0.5, (y + 0.5) * image.height / height - 0.5, sample);
        const offset = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) data[offset + c] = Math.round(sample[c]!);
      }
    }
    widthScale /= image.width / width;
    heightScale /= image.height / height;
    image = { width, height, data };
  }
  return image;
}
