import { expect, it, vi } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodePngImage, encodePngImage } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";

for (const stored of [false, true]) {
  it(`honors forced opacity with automatic palettes, stored=${stored}`, async () => {
    const image: RgbaImage = { width: 1, height: 1, data: Uint8Array.of(12, 34, 56, 78), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true };
    const options = { palette: true, forceOpaque: true };
    const chunks: Uint8Array[] = [];
    if (stored) {
      const storage = { allocate: vi.fn(), read: vi.fn(async () => image.data), write: vi.fn() };
      for await (const chunk of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) chunks.push(chunk);
    } else chunks.push(encodePngImage(image, options));
    expect(Array.from(decodePngImage(Buffer.concat(chunks)).data)).toEqual([12, 34, 56, 255]);
  });
}
