import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { encodeGifImage } from "./gif.js";
import { encodeGifFromStorage } from "./gif-storage.js";
import type { RgbaImage } from "../ast.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
it.each([[1, 1], [1, 2], [1, 9], [9, 1], [9, 11], [2051, 13]])("interlaces %ix%i GIF rows with bounded storage reads", async (width, height) => {
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % 19) * 12);
  const image: RgbaImage = { width, height, data, format: "gif", space: "srgb", channels: 4, hasAlpha: false, depth: "uchar", density: 72 };
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length)) };
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeGifFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, { gifInterlace: true })) {
    expect(chunk.length).toBeLessThanOrEqual(4096);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  expect(bytes).toEqual(Buffer.from(encodeGifImage(image, { gifInterlace: true })));
  expect(bytes[790]! & 64).toBe(64);
  expect(await sharp(bytes).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(data));
  expect(storage.read.mock.calls.every(([, length]) => length <= 4096)).toBe(true);
});
