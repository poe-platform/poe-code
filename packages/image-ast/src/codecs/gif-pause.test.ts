import { expect, it, vi } from "vitest";
import { decodeGifImage, encodeGifImage } from "./gif.js";
import { encodeGifFromStorage } from "./gif-storage.js";
import type { RgbaImage } from "../ast.js";

it.each([2, 3])("encodes a transparent pause before an optional changed frame (%i frames)", async frames => {
  const data = new Uint8Array(Array.from({ length: frames * 3 }, (_, i) => i < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat());
  const image: RgbaImage = { width: 3, height: frames, data, format: "gif", space: "srgb", channels: 4, hasAlpha: false, depth: "uchar", density: 72 };
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length)) };
  const options = { pageHeight: 1, delay: [30, 60, 90].slice(0, frames), loop: 4, optimizeFrames: true };
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeGifFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) chunks.push(chunk);
  for (const bytes of [encodeGifImage(image, options), Buffer.concat(chunks)]) {
    expect(decodeGifImage(bytes, { animated: true })).toMatchObject({ data, delay: options.delay, loop: 4 });
    expect(decodeGifImage(bytes, { page: 1, coalesce: false })).toMatchObject({
      width: 1, height: 1, virtualCanvas: { x: 0, y: 0 }, data: new Uint8Array(4),
    });
  }
});
