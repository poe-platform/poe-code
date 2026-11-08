import { expect, it, vi } from "vitest";
import { decodeGifImage, encodeGifImage } from "./gif.js";
import { encodeGifFromStorage } from "./gif-storage.js";
import type { RgbaImage } from "../ast.js";

it.each([false, true])("preserves retained encoder parity with offsetting=%s and transparent differences", async (optimizeFrames) => {
  const data = new Uint8Array(4 * 3 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  data.set([255, 255, 255, 255], 4 * 4);
  data.set([255, 255, 255, 255], 6 * 4);
  data.set(data.subarray(16, 32), 32);
  const image: RgbaImage = { width: 4, height: 3, data, format: "gif", space: "srgb", channels: 4, hasAlpha: false, depth: "uchar", density: 72 };
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length)) };
  const options = { pageHeight: 1, delay: [100, 200, 300], optimizeFrames, gifTransdiff: true };
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeGifFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  expect(bytes).toEqual(Buffer.from(encodeGifImage(image, options)));
  expect(decodeGifImage(bytes, { animated: true }).data).toEqual(data);
  const patch = decodeGifImage(bytes, { page: 1, coalesce: false });
  expect(patch.width).toBe(optimizeFrames ? 3 : 4);
  expect(patch.data[7]).toBe(0);
  expect(decodeGifImage(bytes, { page: 2, coalesce: false }).data[3]).toBe(0);
});
